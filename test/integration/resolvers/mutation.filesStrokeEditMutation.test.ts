import { describe, expect, it } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import { sql, storage } from '../../../src/models/storage';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('Mutation.filesStrokeEditMutation resolver (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('persists stroke history on the frame side file relation', async () => {
    const uid = nextId();
    const frameSideId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `stroke-${frameSideId}.jpg`, 'jpg', hash, 800, 600);
    await fileModel.addFrameRelation(fileId, frameSideId, uid);

    const strokeHistory = [{ x: 1, y: 2, t: Date.now() }];
    const ok = await resolvers.Mutation.filesStrokeEditMutation(
      {},
      { files: [{ frameSideId, fileId, strokeHistory }] },
      { uid: String(uid) }
    );

    expect(ok).toBe(true);

    const rows = await storage().query(sql`
      SELECT strokeHistory FROM files_frame_side_rel
      WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
      LIMIT 1
    `);
    const raw = rows[0]?.strokeHistory;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    expect(parsed).toEqual(strokeHistory);
  });
});
