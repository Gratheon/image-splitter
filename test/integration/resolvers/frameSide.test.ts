import { describe, expect, it } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import { sql, storage } from '../../../src/models/storage';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('FrameSide resolvers (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('resolves __resolveReference and isQueenConfirmed from frame side data', async () => {
    const uid = nextId();
    const frameSideId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `frameside-${frameSideId}.jpg`, 'jpg', hash, 800, 600);
    await fileModel.addFrameRelation(fileId, frameSideId, uid);

    await storage().query(sql`
      UPDATE files_frame_side_rel
      SET queen_detected = TRUE, is_queen_confirmed = TRUE
      WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
    `);

    const frameSideReference = await resolvers.FrameSide.__resolveReference({ id: frameSideId }, { uid: String(uid) });
    const isQueenConfirmed = await resolvers.FrameSide.isQueenConfirmed({ id: frameSideId }, {}, { uid: String(uid) });

    expect(frameSideReference.isQueenConfirmed).toBe(true);
    expect(isQueenConfirmed).toBe(true);
  });
});
