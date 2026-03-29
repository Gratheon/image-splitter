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
        `Timed out waiting for storage connection (mysql host=${config.mysql.host} port=${config.mysql.port} db=${config.mysql.database})`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function ensureResolverTestSchema() {
  await storage().query(sql`
    CREATE TABLE IF NOT EXISTS user_detection_settings (
      user_id BIGINT UNSIGNED NOT NULL,
      sensitivity VARCHAR(16) NOT NULL DEFAULT 'BALANCED',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      min_confidence_percent TINYINT UNSIGNED NOT NULL DEFAULT 60,
      bees_confidence_percent TINYINT UNSIGNED NULL,
      drones_confidence_percent TINYINT UNSIGNED NULL,
      queens_confidence_percent TINYINT UNSIGNED NULL,
      queen_cups_confidence_percent TINYINT UNSIGNED NULL,
      varroa_confidence_percent TINYINT UNSIGNED NULL,
      varroa_bottom_confidence_percent TINYINT UNSIGNED NULL,
      PRIMARY KEY (user_id)
    )
  `);

  await storage().query(sql`
    CREATE TABLE IF NOT EXISTS files_box_rel (
      box_id int unsigned NOT NULL,
      file_id int unsigned NOT NULL,
      user_id int unsigned NOT NULL,
      inspection_id INT NULL DEFAULT NULL,
      added_time datetime DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (box_id, file_id),
      INDEX idx_user_box (user_id, box_id, inspection_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
  `);

  await storage().query(sql`
    CREATE TABLE IF NOT EXISTS varroa_bottom_detections (
      id int unsigned NOT NULL AUTO_INCREMENT,
      file_id int unsigned NOT NULL,
      box_id int unsigned NOT NULL,
      user_id int unsigned NOT NULL,
      varroa_count int NOT NULL DEFAULT 0,
      detections JSON NULL,
      model_version varchar(50) DEFAULT 'yolov11-nano',
      processed_at datetime DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY file_detection (file_id),
      KEY user_box (user_id, box_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
  `);

  const queenColumnRows = await storage().query(sql`
    SELECT COUNT(*) AS cnt
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'files_frame_side_rel'
      AND column_name = 'is_queen_confirmed'
  `);
  if (Number(queenColumnRows?.[0]?.cnt || 0) === 0) {
    await storage().query(sql`
      ALTER TABLE files_frame_side_rel
      ADD COLUMN is_queen_confirmed TINYINT(1) DEFAULT 0
    `);
  }

  await storage().query(sql`
    CREATE TABLE IF NOT EXISTS hive_advice (
      id int unsigned NOT NULL AUTO_INCREMENT,
      hive_id int DEFAULT NULL,
      user_id int DEFAULT NULL,
      question mediumtext,
      answer mediumtext,
      added_time datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY hive_id (hive_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function insertJobForTest(name: string, fileId: number, processEndTimeSql: string | null) {
  try {
    if (processEndTimeSql === null) {
      await storage().query(sql`
        INSERT INTO jobs (name, ref_id, process_end_time, payload, priority)
        VALUES (${name}, ${fileId}, NULL, JSON_OBJECT(), 3)
      `);
    } else {
      await storage().query(sql`
        INSERT INTO jobs (name, ref_id, process_end_time, payload, priority)
        VALUES (${name}, ${fileId}, NOW(), JSON_OBJECT(), 3)
      `);
    }
  } catch (error: any) {
    const message = String(error?.message || error);
    if (!message.includes("Unknown column 'priority'")) {
      throw error;
    }

    if (processEndTimeSql === null) {
      await storage().query(sql`
        INSERT INTO jobs (name, ref_id, process_end_time, payload)
        VALUES (${name}, ${fileId}, NULL, JSON_OBJECT())
      `);
    } else {
      await storage().query(sql`
        INSERT INTO jobs (name, ref_id, process_end_time, payload)
        VALUES (${name}, ${fileId}, NOW(), JSON_OBJECT())
      `);
    }
  }
}

/** Call inside `describe()` so storage + MinIO are ready for resolver integration tests. */
export function registerResolverIntegrationLifecycle() {
  beforeAll(async () => {
    await initStorage(logger);
    await waitForStorageReady();
    await ensureResolverTestSchema();
    await ensureBucketExists();
  });

  afterAll(async () => {
    const db: any = storage();
    if (db?.dispose) {
      await db.dispose();
    }
  });
}
