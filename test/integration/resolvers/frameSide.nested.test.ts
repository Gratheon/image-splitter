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

describe('FrameSide nested resolvers (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('resolves file, frameSideFile, and cells', async () => {
    const uid = nextId();
    const frameSideId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `nested-fs-${frameSideId}.jpg`, 'jpg', hash, 900, 700);

    await fileModel.addFrameRelation(fileId, frameSideId, uid);
    await frameSideCellsModel.addFrameCells(fileId, frameSideId, uid);
    await storage().query(sql`
      UPDATE files_frame_side_cells SET brood = 7 WHERE file_id = ${fileId}
        AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
    `);

    const file = await resolvers.FrameSide.file({ id: frameSideId }, {}, { uid: String(uid) });
    const frameSideFile = await resolvers.FrameSide.frameSideFile({ id: frameSideId }, {}, { uid: String(uid) });
    const cells = await resolvers.FrameSide.cells(
      { id: frameSideId, frameSideId },
      {},
      { uid: String(uid) },
      {} as any
    );

    expect(file?.id).toBe(fileId);
    expect(frameSideFile?.frameSideId).toBe(frameSideId);
    expect(frameSideFile?.fileId).toBe(fileId);
    expect(cells?.broodPercent).toBe(7);
  });
});
