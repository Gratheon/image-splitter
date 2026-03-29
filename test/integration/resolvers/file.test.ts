import { describe, expect, it } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import fileModel from '../../../src/models/file';
import fileResizeModel from '../../../src/models/fileResize';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('File entity resolvers (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('resolves __resolveReference and resizes', async () => {
    const uid = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `fileres-${hash}.jpg`, 'jpg', hash, 1200, 900);

    await fileResizeModel.insertResize(fileId, 512);

    const ref = await resolvers.File.__resolveReference({ id: fileId }, { uid: String(uid) });
    const resizes = await resolvers.File.resizes({ id: fileId }, {}, { uid: String(uid) });

    expect(ref?.id).toBe(fileId);
    expect(Array.isArray(resizes)).toBe(true);
    expect(resizes.length).toBeGreaterThanOrEqual(1);
    expect(resizes[0]?.max_dimension_px).toBe(512);
    expect(String(resizes[0]?.url || '')).toContain('512');
  });
});
