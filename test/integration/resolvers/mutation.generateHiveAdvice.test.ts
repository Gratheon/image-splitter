import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../../../src/models/ai-beekeeper', () => {
  const actual = jest.requireActual('../../../src/models/ai-beekeeper') as typeof import('../../../src/models/ai-beekeeper');
  return {
    __esModule: true,
    default: {
      ...actual.default,
      generateHiveAdvice: jest.fn(async () => '<p>mocked hive advice about bees</p>'),
    },
  };
});

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import beekeeper from '../../../src/models/ai-beekeeper';
import { sql, storage } from '../../../src/models/storage';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('Mutation.generateHiveAdvice resolver (integration)', () => {
  registerResolverIntegrationLifecycle();

  beforeEach(() => {
    const mockedGenerateHiveAdvice = beekeeper.generateHiveAdvice as unknown as jest.Mock;
    mockedGenerateHiveAdvice.mockImplementation(async () => '<p>mocked hive advice about bees</p>');
  });

  it('returns AI HTML and stores hive_advice when billing plan allows', async () => {
    const uid = nextId();
    const hiveID = nextId();

    const html = await resolvers.Mutation.generateHiveAdvice(
      {},
      {
        hiveID,
        adviceContext: { notes: 'bee hive inspection varroa check' },
        langCode: 'en',
      },
      { uid: String(uid), billingPlan: 'starter' }
    );

    expect(html).toContain('mocked hive advice');
    expect(beekeeper.generateHiveAdvice).toHaveBeenCalled();

    const rows = await storage().query(sql`
      SELECT answer FROM hive_advice WHERE user_id = ${uid} AND hive_id = ${hiveID} ORDER BY added_time DESC LIMIT 1
    `);
    expect(String(rows[0]?.answer || '')).toContain('mocked hive advice');
  });

  it('returns upgrade message when billing plan is not allowed', async () => {
    const html = await resolvers.Mutation.generateHiveAdvice(
      {},
      { hiveID: nextId(), adviceContext: { bee: 'hive' }, langCode: 'en' },
      { uid: String(nextId()), billingPlan: 'free' }
    );
    expect(html).toContain('Starter');
  });
});
