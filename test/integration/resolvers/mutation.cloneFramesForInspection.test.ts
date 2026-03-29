import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../../../src/models/telemetryClient', () => ({
  sendPopulationMetrics: jest.fn(async () => undefined),
}));

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import frameSideCellsModel from '../../../src/models/frameSideCells';
import { sql, storage } from '../../../src/models/storage';
import { sendPopulationMetrics } from '../../../src/models/telemetryClient';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('Mutation.cloneFramesForInspection resolver (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('assigns inspection id to frame relations and emits population metrics', async () => {
    const uid = nextId();
    const hiveId = nextId();
    const frameSideId = nextId();
    const inspectionId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `clone-${inspectionId}.jpg`, 'jpg', hash, 800, 600);

    await fileModel.addHiveRelation(fileId, hiveId, uid);
    await fileModel.addFrameRelation(fileId, frameSideId, uid);
    await frameSideCellsModel.addFrameCells(fileId, frameSideId, uid);

    await storage().query(sql`
      UPDATE files_frame_side_rel
      SET worker_bee_count = 2, drone_count = 1, varroa_count = 1
      WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
    `);

    const ok = await resolvers.Mutation.cloneFramesForInspection(
      {},
      { frameSideIDs: [frameSideId], inspectionId },
      { uid: String(uid) }
    );

    expect(ok).toBe(true);

    const rel = await storage().query(sql`
      SELECT inspection_id FROM files_frame_side_rel
      WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid}
      ORDER BY added_time DESC LIMIT 1
    `);
    expect(rel[0]?.inspection_id).toBe(inspectionId);

    expect(jest.mocked(sendPopulationMetrics)).toHaveBeenCalled();
    const args = jest.mocked(sendPopulationMetrics).mock.calls[0];
    expect(args[0]).toBe(hiveId);
    expect(String(args[4])).toBe(String(inspectionId));
  });
});
