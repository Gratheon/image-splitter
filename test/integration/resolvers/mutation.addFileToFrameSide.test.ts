import { describe, expect, it, jest } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import { TYPE_BEES, TYPE_CELLS, TYPE_CUPS, TYPE_DRONES, TYPE_QUEENS, TYPE_VARROA } from '../../../src/models/jobs';
import jobs from '../../../src/models/jobs';
import { sql, storage } from '../../../src/models/storage';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('Mutation.addFileToFrameSide resolver (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('adds file to frame side with uid fallback and creates detection jobs', async () => {
    const uid = nextId();
    const frameSideId = nextId();
    const hiveId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `file-${frameSideId}.jpg`, 'jpg', hash, 1920, 1080);
    const encodedFileId = Buffer.from(`File:${fileId}`).toString('base64');
    const encodedFrameSideId = Buffer.from(`FrameSide:${frameSideId}`).toString('base64');
    const encodedHiveId = Buffer.from(`Hive:${hiveId}`).toString('base64');
    const addJobSpy = jest.spyOn(jobs, 'addJob').mockResolvedValue(undefined);

    try {
      const result = await resolvers.Mutation.addFileToFrameSide(
        {},
        { frameSideId: encodedFrameSideId, fileId: encodedFileId, hiveId: encodedHiveId },
        { uid: undefined }
      );

      expect(result).toBe(true);

      const frameRel = await storage().query(sql`
        SELECT file_id, frame_side_id, user_id
        FROM files_frame_side_rel
        WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
        LIMIT 1
      `);
      expect(frameRel.length).toBe(1);

      const hiveRel = await storage().query(sql`
        SELECT file_id, hive_id, user_id
        FROM files_hive_rel
        WHERE file_id = ${fileId} AND hive_id = ${hiveId} AND user_id = ${uid}
        LIMIT 1
      `);
      expect(hiveRel.length).toBe(1);

      const frameCells = await storage().query(sql`
        SELECT file_id FROM files_frame_side_cells
        WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
        LIMIT 1
      `);
      expect(frameCells.length).toBe(1);

      const frameCups = await storage().query(sql`
        SELECT file_id FROM files_frame_side_queen_cups
        WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
        LIMIT 1
      `);
      expect(frameCups.length).toBe(1);

      const createdJobNames = new Set(addJobSpy.mock.calls.map((call) => call[0]));
      expect(createdJobNames).toEqual(new Set([TYPE_BEES, TYPE_DRONES, TYPE_CELLS, TYPE_CUPS, TYPE_QUEENS, TYPE_VARROA]));
    } finally {
      addJobSpy.mockRestore();
    }
  });
});
