import { describe, expect, it } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import { registerResolverIntegrationLifecycle } from './helpers';

describe('Query.hello_image_splitter resolver (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('returns the static greeting', () => {
    expect(resolvers.Query.hello_image_splitter()).toBe('hi');
  });
});
