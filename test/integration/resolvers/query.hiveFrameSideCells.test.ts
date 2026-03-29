import { describe, expect, it } from '@jest/globals';

jest.mock('graphql-parse-resolve-info', () => ({
  parseResolveInfo: () => ({}),
  simplifyParsedResolveInfoFragmentWithType: () => ({ fields: {} }),
}));

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import frameSideCellsModel from '../../../src/models/frameSideCells';
import { sql, storage } from '../../../src/models/storage';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('Query.hiveFrameSideCells resolver (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('returns FrameSideCells composition for the frame side', async () => {
    const uid = nextId();
    const frameSideId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `cells-${frameSideId}.jpg`, 'jpg', hash, 800, 600);

    await fileModel.addFrameRelation(fileId, frameSideId, uid);
    await frameSideCellsModel.addFrameCells(fileId, frameSideId, uid);

    await storage().query(sql`
      UPDATE files_frame_side_cells
      SET brood = 10, honey = 20, eggs = 5
      WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
    `);

    const cells = await resolvers.Query.hiveFrameSideCells(
      {},
      { frameSideId },
      { uid: String(uid) },
      {} as any
    );

    expect(cells).not.toBeNull();
    expect(cells?.__typename).toBe('FrameSideCells');
    expect(cells?.broodPercent).toBe(10);
    expect(cells?.honeyPercent).toBe(20);
    expect(cells?.eggsPercent).toBe(5);
  });
});
