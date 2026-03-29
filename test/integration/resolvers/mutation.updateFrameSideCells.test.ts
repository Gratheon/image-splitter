import { describe, expect, it } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import frameSideCellsModel from '../../../src/models/frameSideCells';
import { sql, storage } from '../../../src/models/storage';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('Mutation.updateFrameSideCells resolver (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('updates relative cell percentages for the frame side', async () => {
    const uid = nextId();
    const frameSideId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `ufsc-${frameSideId}.jpg`, 'jpg', hash, 900, 700);
    await fileModel.addFrameRelation(fileId, frameSideId, uid);
    await frameSideCellsModel.addFrameCells(fileId, frameSideId, uid);

    const ok = await resolvers.Mutation.updateFrameSideCells(
      {},
      {
        cells: {
          id: frameSideId,
          broodPercent: 11,
          honeyPercent: 22,
          eggsPercent: 33,
          nectarPercent: 0,
          pollenPercent: 0,
          cappedBroodPercent: 0,
          droneBroodPercent: 0,
        },
      },
      { uid: String(uid) }
    );

    expect(ok).toBe(true);

    const rows = await storage().query(sql`
      SELECT brood, honey, eggs FROM files_frame_side_cells
      WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
      LIMIT 1
    `);
    expect(Number(rows[0]?.brood)).toBe(11);
    expect(Number(rows[0]?.honey)).toBe(22);
    expect(Number(rows[0]?.eggs)).toBe(33);
  });
});
