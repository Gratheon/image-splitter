import { afterAll, beforeAll } from '@jest/globals';

import config from '../../../src/config';
import { logger } from '../../../src/logger';
import { ensureBucketExists } from '../../../src/models/s3';
import { initStorage, isStorageConnected, sql, storage } from '../../../src/models/storage';

const runSeed = Math.floor(Math.random() * 10_000_000);
let seq = 0;

export function nextId(): number {
  seq += 1;
  return 1_000_000_000 + runSeed * 100 + seq;
}

export async function waitForStorageReady(timeoutMs = 20000) {
  const start = Date.now();
  while (!isStorageConnected()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for storage connection (postgres host=${config.postgres.host} port=${config.postgres.port} db=${config.postgres.database})`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function insertJobForTest(name: string, fileId: number, processEndTimeSql: string | null) {
  if (processEndTimeSql === null) {
    await storage().query(sql`
      INSERT INTO jobs (name, ref_id, process_end_time, payload, priority)
      VALUES (${name}, ${fileId}, NULL, '{}'::jsonb, 3)
    `);
  } else {
    await storage().query(sql`
      INSERT INTO jobs (name, ref_id, process_end_time, payload, priority)
      VALUES (${name}, ${fileId}, NOW(), '{}'::jsonb, 3)
    `);
  }
}

/** Call inside `describe()` so storage + MinIO are ready for resolver integration tests. */
export function registerResolverIntegrationLifecycle() {
  beforeAll(async () => {
    await initStorage(logger);
    await waitForStorageReady();
    await ensureBucketExists();
  });

  afterAll(async () => {
    const db: any = storage();
    if (db?.dispose) {
      await db.dispose();
    }
  });
}
