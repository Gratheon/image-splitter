import { describe, expect, it } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import { TYPE_BEES, TYPE_CELLS } from '../../../src/models/jobs';
import { sql, storage } from '../../../src/models/storage';
import { insertJobForTest, nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('FrameSideFile resolvers (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('resolves queenDetected and job completion fields for frame side file', async () => {
    const uid = nextId();
    const frameSideId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `framesidefile-${frameSideId}.jpg`, 'jpg', hash, 800, 600);
    await fileModel.addFrameRelation(fileId, frameSideId, uid);

    await storage().query(sql`
      UPDATE files_frame_side_rel
      SET queen_detected = TRUE, is_queen_confirmed = TRUE
      WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
    `);

    await insertJobForTest(TYPE_BEES, fileId, 'NOW');
    await insertJobForTest(TYPE_CELLS, fileId, null);

    const queenDetected = await resolvers.FrameSideFile.queenDetected({ frameSideId, fileId }, {}, { uid: String(uid) });
    const isBeeDetectionComplete = await resolvers.FrameSideFile.isBeeDetectionComplete(
      { frameSideId, fileId },
      {},
      { uid: String(uid) }
    );
    const isCellsDetectionComplete = await resolvers.FrameSideFile.isCellsDetectionComplete(
      { frameSideId, fileId },
      {},
      { uid: String(uid) }
    );

    expect(queenDetected).toBe(true);
    expect(isBeeDetectionComplete).toBe(true);
    expect(isCellsDetectionComplete).toBe(false);
  });
});
