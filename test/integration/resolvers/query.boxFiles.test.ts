import { describe, expect, it } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import { sql, storage } from '../../../src/models/storage';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('Query.boxFiles resolver (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('returns box files with file urls for current (null inspection) state', async () => {
    const uid = nextId();
    const hiveId = nextId();
    const boxId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `box-${boxId}.jpg`, 'jpg', hash, 800, 600);

    await fileModel.addHiveRelation(fileId, hiveId, uid);
    await storage().query(sql`
      INSERT INTO files_box_rel (box_id, file_id, user_id, inspection_id)
      VALUES (${boxId}, ${fileId}, ${uid}, NULL)
    `);

    const rows = await resolvers.Query.boxFiles({}, { boxId, inspectionId: null }, { uid: String(uid) });

    expect(rows.length).toBe(1);
    expect(rows[0]?.file?.id).toBe(fileId);
    expect(rows[0]?.boxId).toBe(boxId);
    expect(String(rows[0]?.file?.url || '')).toContain(String(uid));
  });
});
