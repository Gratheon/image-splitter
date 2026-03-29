import { describe, expect, it } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('Query.hiveFrameSideFile resolver (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('returns the latest FrameSideFile for the frame side', async () => {
    const uid = nextId();
    const frameSideId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `hfsf-${frameSideId}.jpg`, 'jpg', hash, 1024, 768);

    await fileModel.addFrameRelation(fileId, frameSideId, uid);

    const fsf = await resolvers.Query.hiveFrameSideFile({}, { frameSideId }, { uid: String(uid) });

    expect(fsf).not.toBeNull();
    expect(fsf?.frameSideId).toBe(frameSideId);
    expect(fsf?.file?.id).toBe(fileId);
  });
});
