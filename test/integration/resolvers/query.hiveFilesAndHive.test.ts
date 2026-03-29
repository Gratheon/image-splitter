import { describe, expect, it, jest } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('Query.hiveFiles and Hive resolvers (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('lists frame-side files for a hive and resolves Hive.files and Hive.beeCount', async () => {
    const uid = nextId();
    const hiveId = nextId();
    const frameSideId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `hive-files-${frameSideId}.jpg`, 'jpg', hash, 1200, 900);

    await fileModel.addHiveRelation(fileId, hiveId, uid);
    await fileModel.addFrameRelation(fileId, frameSideId, uid);

    const fromQuery = (await resolvers.Query.hiveFiles({}, { hiveId }, { uid: String(uid) })) as Array<{
      file?: { id?: number };
      frameSideId?: number;
    }>;
    const hiveFiles = (await resolvers.Hive.files({ id: hiveId }, {}, { uid: String(uid) })) as typeof fromQuery;
    const beeCount = await resolvers.Hive.beeCount({ id: hiveId }, {}, { uid: String(uid) });

    expect(fromQuery.length).toBe(1);
    expect(hiveFiles.length).toBe(1);
    expect(fromQuery[0]?.file?.id).toBe(fileId);
    expect(hiveFiles[0]?.file?.id).toBe(fileId);
    expect(fromQuery[0]?.frameSideId).toBe(frameSideId);

    expect(beeCount === null || typeof beeCount === 'number').toBe(true);
  });
});
