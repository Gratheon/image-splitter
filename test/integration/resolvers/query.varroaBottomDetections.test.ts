import { describe, expect, it } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import { sql, storage } from '../../../src/models/storage';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('Query.varroaBottomDetections resolver (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('returns latest varroa bottom detection for a box', async () => {
    const uid = nextId();
    const hiveId = nextId();
    const boxId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `vbd-${boxId}.jpg`, 'jpg', hash, 600, 400);

    await fileModel.addHiveRelation(fileId, hiveId, uid);
    await storage().query(sql`
      INSERT INTO files_box_rel (box_id, file_id, user_id, inspection_id)
      VALUES (${boxId}, ${fileId}, ${uid}, NULL)
    `);
    await storage().query(sql`
      INSERT INTO varroa_bottom_detections (file_id, box_id, user_id, varroa_count, detections)
      VALUES (${fileId}, ${boxId}, ${uid}, 5, JSON_ARRAY())
      ON DUPLICATE KEY UPDATE varroa_count = VALUES(varroa_count)
    `);

    const row = await resolvers.Query.varroaBottomDetections(
      {},
      { boxId, inspectionId: null },
      { uid: String(uid) }
    );

    expect(row).not.toBeNull();
    expect(row?.fileId).toBe(fileId);
    expect(row?.boxId).toBe(boxId);
    expect(row?.varroaCount).toBe(5);
  });
});
