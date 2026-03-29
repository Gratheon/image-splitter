import { describe, expect, it, jest } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('detection settings resolvers (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('round-trips detection settings via Mutation.setDetectionConfidencePercents and Query.detectionSettings', async () => {
    const uid = nextId();
    const confidencePercents = {
      bees: 70,
      drones: 50,
      queens: 80,
      queenCups: 60,
      varroa: 90,
      varroaBottom: 40,
    };

    const updated = await resolvers.Mutation.setDetectionConfidencePercents(
      {},
      { confidencePercents },
      { uid: String(uid) }
    );
    const fetched = await resolvers.Query.detectionSettings({}, {}, { uid: String(uid) });

    expect(updated.confidencePercents).toEqual(confidencePercents);
    expect(updated.thresholds).toEqual({
      bees: 0.7,
      drones: 0.5,
      queens: 0.8,
      queenCups: 0.6,
      varroa: 0.9,
      varroaBottom: 0.4,
    });
    expect(fetched.confidencePercents).toEqual(confidencePercents);
  });
});
