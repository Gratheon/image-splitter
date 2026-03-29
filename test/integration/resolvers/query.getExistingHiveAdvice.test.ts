import { describe, expect, it } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../../src/graphql/resolvers';
import { sql, storage } from '../../../src/models/storage';
import { nextId, registerResolverIntegrationLifecycle } from './helpers';

describe('Query.getExistingHiveAdvice resolver (integration)', () => {
  registerResolverIntegrationLifecycle();

  it('returns the latest stored advice answer for the hive', async () => {
    const uid = nextId();
    const hiveID = nextId();
    const answer = `<p>integration-${Date.now()}</p>`;

    await storage().query(sql`
      INSERT INTO hive_advice (user_id, hive_id, question, answer)
      VALUES (${uid}, ${hiveID}, ${'q'}, ${answer})
    `);

    const out = await resolvers.Query.getExistingHiveAdvice({}, { hiveID }, { uid: String(uid) });
    expect(out).toBe(answer);
  });
});
