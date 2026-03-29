import { describe, expect, it } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import { TYPE_CUPS, TYPE_DRONES, TYPE_QUEENS } from '../../../src/models/jobs';
import { sql, storage } from '../../../src/models/storage';
import { insertJobForTest, nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('FrameSideFile detection and count resolvers (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('exposes detection aggregates and completion flags', async () => {
    const uid = nextId();
    const frameSideId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `fsfd-${frameSideId}.jpg`, 'jpg', hash, 800, 600);
    await fileModel.addFrameRelation(fileId, frameSideId, uid);
    await storage().query(sql`
      INSERT INTO files_frame_side_cells (file_id, frame_side_id, user_id)
      VALUES (${fileId}, ${frameSideId}, ${uid})
    `);

    const workerBee = { n: 0, c: 0.9, x: 0, y: 0, w: 1, h: 1 };
    const droneDet = { n: 1, c: 0.9, x: 0, y: 0, w: 1, h: 1 };
    await storage().query(sql`
      UPDATE files_frame_side_rel
      SET queen_detected = TRUE,
          worker_bee_count = 3,
          drone_count = 2,
          queen_count = 1,
          varroa_count = 4,
          detected_bees = ${JSON.stringify([workerBee])},
          detected_varroa = ${JSON.stringify([{ c: 0.8 }])},
          detected_drones = ${JSON.stringify([droneDet])}
      WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
    `);

    await storage().query(sql`
      UPDATE files_frame_side_cells SET cells = ${JSON.stringify([[1, 0, 0, 0, 0, 0]])}
      WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
    `);

    await insertJobForTest(TYPE_DRONES, fileId, 'NOW');
    await insertJobForTest(TYPE_QUEENS, fileId, 'NOW');
    await insertJobForTest(TYPE_CUPS, fileId, 'NOW');

    const parent = { frameSideId, fileId };

    const [
      detectedBees,
      detectedVarroa,
      detectedCells,
      detectedQueenCount,
      varroaCount,
      detectedWorkerBeeCount,
      detectedDroneCount,
      detectedDrones,
      isDroneDetectionComplete,
      isQueenDetectionComplete,
      isQueenCupsDetectionComplete,
    ] = await Promise.all([
      resolvers.FrameSideFile.detectedBees(parent, {}, { uid: String(uid) }),
      resolvers.FrameSideFile.detectedVarroa(parent, {}, { uid: String(uid) }),
      resolvers.FrameSideFile.detectedCells(parent, {}, { uid: String(uid) }),
      resolvers.FrameSideFile.detectedQueenCount(parent, {}, { uid: String(uid) }),
      resolvers.FrameSideFile.varroaCount(parent, {}, { uid: String(uid) }),
      resolvers.FrameSideFile.detectedWorkerBeeCount(parent, {}, { uid: String(uid) }),
      resolvers.FrameSideFile.detectedDroneCount(parent, {}, { uid: String(uid) }),
      resolvers.FrameSideFile.detectedDrones(parent, {}, { uid: String(uid) }),
      resolvers.FrameSideFile.isDroneDetectionComplete(parent, {}, { uid: String(uid) }),
      resolvers.FrameSideFile.isQueenDetectionComplete(parent, {}, { uid: String(uid) }),
      resolvers.FrameSideFile.isQueenCupsDetectionComplete(parent, {}, { uid: String(uid) }),
    ]);

    expect(Array.isArray(detectedBees)).toBe(true);
    expect(detectedVarroa).not.toBeNull();
    expect(detectedCells).not.toBeNull();
    expect(detectedQueenCount).toBe(1);
    expect(varroaCount).toBe(4);
    expect(detectedWorkerBeeCount).toBe(3);
    expect(detectedDroneCount).toBe(2);
    expect(detectedDrones).not.toBeNull();
    expect(isDroneDetectionComplete).toBe(true);
    expect(isQueenDetectionComplete).toBe(true);
    expect(isQueenCupsDetectionComplete).toBe(true);
  });
});
