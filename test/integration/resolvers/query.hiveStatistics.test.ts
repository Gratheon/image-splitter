import { describe, expect, it, jest } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import { sql, storage } from '../../../src/models/storage';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('Query.hiveStatistics resolver (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('returns hive statistics aggregated from frame and bottom detections', async () => {
    const uid = nextId();
    const frameSideId = nextId();
    const hiveId = nextId();
    const boxId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `stats-${frameSideId}.jpg`, 'jpg', hash, 1200, 900);

    await fileModel.addFrameRelation(fileId, frameSideId, uid);
    await fileModel.addHiveRelation(fileId, hiveId, uid);

    await storage().query(sql`
      UPDATE files_frame_side_rel
      SET worker_bee_count = 8, drone_count = 2, queen_count = 1, varroa_count = 3
      WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
    `);

    await storage().query(sql`
      INSERT INTO files_box_rel (box_id, file_id, user_id) VALUES (${boxId}, ${fileId}, ${uid})
    `);
    await storage().query(sql`
      INSERT INTO varroa_bottom_detections (file_id, box_id, user_id, varroa_count, detections)
      VALUES (${fileId}, ${boxId}, ${uid}, 4, JSON_ARRAY())
      ON DUPLICATE KEY UPDATE varroa_count = VALUES(varroa_count)
    `);

    const statistics = await resolvers.Query.hiveStatistics({}, { hiveId }, { uid: String(uid) });

    expect(statistics).toEqual({
      workerBeeCount: 11,
      droneCount: 2,
      varroaCount: 7,
    });
  });
});
