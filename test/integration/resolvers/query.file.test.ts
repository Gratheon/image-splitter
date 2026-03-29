import path from 'path';
import { describe, expect, it } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import uploadToS3 from '../../../src/models/s3';
import { sql, storage } from '../../../src/models/storage';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('Query.file resolver (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('resolves file query for object stored in real minio', async () => {
    const uid = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fixturePath = path.resolve(__dirname, '../fixture/IMG_4368.JPG');
    const key = `${uid}/${hash}/original.jpg`;
    const uploadedUrl = await uploadToS3(fixturePath, key);
    const fileId = await fileModel.insert(uid, `minio-${hash}.jpg`, 'jpg', hash, 1200, 900);

    const file = await resolvers.Query.file({}, { id: fileId }, { uid: String(uid) });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let uploadedFileResponse: Response;
    try {
      uploadedFileResponse = await fetch(uploadedUrl, { method: 'GET', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    expect(file.id).toBe(fileId);
    expect(file.url).toBe(uploadedUrl);
    expect([200, 206, 403]).toContain(uploadedFileResponse.status);

    const dbRows = await storage().query(sql`
      SELECT id, user_id FROM files WHERE id = ${fileId} LIMIT 1
    `);
    expect(dbRows[0]?.id).toBe(fileId);
    expect(Number(dbRows[0]?.user_id)).toBe(uid);
  });
});
