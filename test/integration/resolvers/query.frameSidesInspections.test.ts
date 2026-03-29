import { describe, expect, it } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import { sql, storage } from '../../../src/models/storage';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('Query.frameSidesInspections resolver (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('returns frame sides recorded for an inspection', async () => {
    const uid = nextId();
    const frameSideId = nextId();
    const inspectionId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `insp-${inspectionId}.jpg`, 'jpg', hash, 640, 480);

    await storage().query(sql`
      INSERT INTO files_frame_side_rel (file_id, frame_side_id, user_id, inspection_id)
      VALUES (${fileId}, ${frameSideId}, ${uid}, ${inspectionId})
    `);

    const rows = await resolvers.Query.frameSidesInspections(
      {},
      { frameSideIds: [], inspectionId },
      { uid: String(uid) }
    );

    expect(rows.some((r: any) => r.frameSideId === frameSideId && r.inspectionId === inspectionId)).toBe(true);
  });
});
