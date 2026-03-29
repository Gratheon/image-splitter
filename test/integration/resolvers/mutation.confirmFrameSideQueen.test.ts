import { describe, expect, it } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import { sql, storage } from '../../../src/models/storage';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('Mutation.confirmFrameSideQueen resolver (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('updates is_queen_confirmed for the latest frame side relation', async () => {
    const uid = nextId();
    const frameSideId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `cfq-${frameSideId}.jpg`, 'jpg', hash, 640, 480);
    await fileModel.addFrameRelation(fileId, frameSideId, uid);

    const ok = await resolvers.Mutation.confirmFrameSideQueen(
      {},
      { frameSideId, isConfirmed: true },
      { uid: String(uid) }
    );
    expect(ok).toBe(true);

    const rows = await storage().query(sql`
      SELECT is_queen_confirmed FROM files_frame_side_rel
      WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
      LIMIT 1
    `);
    expect(Number(rows[0]?.is_queen_confirmed)).toBe(1);
  });
});
