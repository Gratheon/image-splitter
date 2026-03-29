import { describe, expect, it, jest } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import frameSideCellsModel from '../../../src/models/frameSideCells';
import { sql, storage } from '../../../src/models/storage';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('FrameSideInspection resolvers (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('resolves file, cells, and frameSideFile for an inspection snapshot', async () => {
    const uid = nextId();
    const frameSideId = nextId();
    const inspectionId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `fsi-${inspectionId}.jpg`, 'jpg', hash, 700, 500);

    await storage().query(sql`
      INSERT INTO files_frame_side_rel (file_id, frame_side_id, user_id, inspection_id)
      VALUES (${fileId}, ${frameSideId}, ${uid}, ${inspectionId})
    `);
    await storage().query(sql`
      INSERT INTO files_frame_side_cells (file_id, frame_side_id, user_id, inspection_id, brood, honey)
      VALUES (${fileId}, ${frameSideId}, ${uid}, ${inspectionId}, 12, 15)
    `);

    const parent = { frameSideId, inspectionId };

    const file = await resolvers.FrameSideInspection.file(parent, {}, { uid: String(uid) });
    const cells = await resolvers.FrameSideInspection.cells(parent, {}, { uid: String(uid) });
    const fsf = await resolvers.FrameSideInspection.frameSideFile(parent, {}, { uid: String(uid) });

    expect(file?.id).toBe(fileId);
    expect(cells?.broodPercent).toBe(12);
    expect(cells?.honeyPercent).toBe(15);
    expect(fsf).toEqual({ frameSideId });
  });
});
