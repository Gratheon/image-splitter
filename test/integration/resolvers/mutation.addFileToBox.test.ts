import { describe, expect, it, jest } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import { TYPE_VARROA_BOTTOM } from '../../../src/models/jobs';
import jobs from '../../../src/models/jobs';
import { sql, storage } from '../../../src/models/storage';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('Mutation.addFileToBox resolver (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('links file to box and hive; enqueues bottom varroa job for BOTTOM boxes', async () => {
    const uid = nextId();
    const boxId = nextId();
    const hiveId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `boxfile-${boxId}.jpg`, 'jpg', hash, 600, 400);

    const addJobSpy = jest.spyOn(jobs, 'addJob').mockResolvedValue(undefined);

    try {
      const ok = await resolvers.Mutation.addFileToBox(
        {},
        { boxId, fileId, hiveId, boxType: 'BOTTOM' },
        { uid: String(uid) }
      );
      expect(ok).toBe(true);

      const rel = await storage().query(sql`
        SELECT box_id, file_id FROM files_box_rel
        WHERE box_id = ${boxId} AND file_id = ${fileId} AND user_id = ${uid} LIMIT 1
      `);
      expect(rel.length).toBe(1);

      const hiveRel = await storage().query(sql`
        SELECT hive_id FROM files_hive_rel WHERE file_id = ${fileId} AND user_id = ${uid} LIMIT 1
      `);
      expect(hiveRel[0]?.hive_id).toBe(hiveId);

      const bottomJobs = addJobSpy.mock.calls.filter((c) => c[0] === TYPE_VARROA_BOTTOM);
      expect(bottomJobs.length).toBe(1);
      expect(bottomJobs[0]?.[1]).toBe(fileId);
    } finally {
      addJobSpy.mockRestore();
    }
  });

  it('does not enqueue varroa bottom job when boxType is not BOTTOM', async () => {
    const uid = nextId();
    const boxId = nextId();
    const hiveId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `boxfile2-${boxId}.jpg`, 'jpg', hash, 600, 400);

    const addJobSpy = jest.spyOn(jobs, 'addJob').mockResolvedValue(undefined);

    try {
      await resolvers.Mutation.addFileToBox({}, { boxId, fileId, hiveId, boxType: 'SUPER' }, { uid: String(uid) });
      const bottomJobs = addJobSpy.mock.calls.filter((c) => c[0] === TYPE_VARROA_BOTTOM);
      expect(bottomJobs.length).toBe(0);
    } finally {
      addJobSpy.mockRestore();
    }
  });
});
