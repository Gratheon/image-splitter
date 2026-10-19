#!/usr/bin/env node
/*
 * One-off copy of image-splitter data from MySQL to Postgres.
 *
 * WHY: the service switched its storage from MySQL to Postgres. Data volume is small
 * (tens of thousands of rows, a few hundred MB mostly in JSON detection columns), so a
 * batched read / batch-insert copy is simpler and more predictable than pgloader
 * (which would create its own schema and types).
 *
 * WHAT it does:
 *   1. applies ./migrations/*.sql to Postgres and records them in _db_migrations
 *      exactly like src/models/storage.ts does, so the service skips them on boot
 *   2. in ONE transaction: truncates target tables, copies every row with its original id
 *      in primary-key order and in small batches (rows carry up to ~300 KB of JSON, so whole
 *      tables are never held in memory), resets SERIAL sequences, verifies row counts and
 *      per-column content (non-null counts, JSON element counts), and rolls back on any mismatch
 *
 * There are no foreign keys, so table order does not matter. No data cleanup is done.
 *
 * MySQL is only read, so it stays intact as a rollback target.
 * All connection settings come from env variables; nothing environment specific lives here.
 *
 * Run (from the repo root, deps are installed into a throwaway dir):
 *   docker run --rm --network host -v "$PWD":/repo -w /repo \
 *     -e MYSQL_HOST -e MYSQL_PORT -e MYSQL_USER -e MYSQL_PASSWORD -e MYSQL_DATABASE \
 *     -e PG_HOST -e PG_PORT -e PG_USER -e PG_PASSWORD -e PG_DATABASE -e PG_SSL -e DRY_RUN -e FORCE \
 *     node:24-slim sh -c 'npm i --prefix /tmp/deps mysql2@3 pg@8 >/dev/null && NODE_PATH=/tmp/deps/node_modules node scripts/migrate-mysql-to-postgres.js'
 *
 * DRY_RUN=1 performs the full copy and verification, then rolls the data copy back.
 * FORCE=1 is required when Postgres tables already contain rows (e.g. a second rehearsal),
 * so that a re-run after cutover cannot silently wipe data written by the new service.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");
const { Client } = require("pg");

// Primary key per table: rows are read in this order with keyset pagination
const TABLES = {
  files: ["id"],
  files_resized: ["id"],
  files_hive_rel: ["hive_id", "file_id"],
  files_box_rel: ["box_id", "file_id"],
  files_frame_side_rel: ["frame_side_id", "file_id"],
  files_frame_side_cells: ["frame_side_id", "file_id"],
  files_frame_side_queen_cups: ["frame_side_id", "file_id"],
  hive_advice: ["id"],
  jobs: ["id"],
  user_detection_settings: ["user_id"],
  varroa_bottom_detections: ["id"],
};
const JSON_COLUMNS = new Set([
  "strokeHistory",
  "detected_bees",
  "detected_drones",
  "detected_varroa",
  "detected_queens",
  "cells",
  "cups",
  "payload",
  "detections",
]);
// MySQL TINYINT(1) -> Postgres BOOLEAN
const BOOLEAN_COLUMNS = new Set(["queen_detected", "is_queen_confirmed"]);

// Small batches: a single files_frame_side_rel row can hold ~300 KB of JSON
const BATCH_SIZE = 200;
const DRY_RUN = process.env.DRY_RUN === "1";
const FORCE = process.env.FORCE === "1";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env ${name}`);
  }
  return value;
}

function convertValue(column, value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (JSON_COLUMNS.has(column)) {
    // mysql2 already parses JSON columns, so always re-serialize: node-pg would turn a JS array
    // (all detection columns are arrays) into a Postgres array literal, and a JSON string scalar
    // arrives as a plain JS string that would otherwise be sent unquoted
    return JSON.stringify(value);
  }
  if (BOOLEAN_COLUMNS.has(column)) {
    return Number(value) !== 0;
  }
  // MySQL zero dates have no Postgres equivalent
  if (typeof value === "string" && value.startsWith("0000-00-00")) {
    return null;
  }
  return value;
}

async function applyMigrations(pg) {
  await pg.query(`CREATE TABLE IF NOT EXISTS _db_migrations (
    hash VARCHAR(255),
    filename VARCHAR(255),
    execution_time TIMESTAMPTZ
  );`);

  const dir = path.join(process.cwd(), "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), "utf8");
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    const { rows } = await pg.query(
      "SELECT 1 FROM _db_migrations WHERE filename = $1 OR hash = $2 LIMIT 1",
      [file, hash]
    );
    if (rows.length > 0) {
      console.log(`migration ${file}: already applied`);
      continue;
    }
    await pg.query("BEGIN");
    try {
      await pg.query(content);
      await pg.query(
        "INSERT INTO _db_migrations (hash, filename, execution_time) VALUES ($1, $2, NOW())",
        [hash, file]
      );
      await pg.query("COMMIT");
      console.log(`migration ${file}: applied`);
    } catch (err) {
      await pg.query("ROLLBACK");
      throw err;
    }
  }
}

async function pgColumns(pg, table) {
  const { rows } = await pg.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position",
    [table]
  );
  return rows.map((r) => r.column_name);
}

async function mysqlColumns(my, table) {
  const [rows] = await my.query(
    "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
    [table]
  );
  return rows.map((r) => r.name);
}

async function copyTable(my, pg, table) {
  const pk = TABLES[table];
  const sourceColumns = await mysqlColumns(my, table);
  const targetColumns = await pgColumns(pg, table);

  // Fail loudly instead of silently dropping data if schemas drifted
  const missing = sourceColumns.filter((c) => !targetColumns.includes(c));
  if (missing.length > 0) {
    throw new Error(`${table}: columns missing in Postgres: ${missing.join(", ")}`);
  }

  const selectList = sourceColumns.map((c) => `\`${c}\``).join(", ");
  const orderBy = pk.map((c) => `\`${c}\``).join(", ");
  const insertList = sourceColumns.map((c) => `"${c}"`).join(", ");

  let copied = 0;
  let lastKey = null;
  for (;;) {
    // Keyset pagination on the primary key: stable and O(n) even for the larger tables
    const where = lastKey ? `WHERE (${orderBy}) > (${pk.map(() => "?").join(", ")})` : "";
    const [batch] = await my.query(
      `SELECT ${selectList} FROM \`${table}\` ${where} ORDER BY ${orderBy} LIMIT ${BATCH_SIZE}`,
      lastKey || []
    );
    if (batch.length === 0) {
      break;
    }

    const params = [];
    const tuples = batch.map((row) => {
      const placeholders = sourceColumns.map((column) => {
        params.push(convertValue(column, row[column]));
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await pg.query(`INSERT INTO "${table}" (${insertList}) VALUES ${tuples.join(", ")}`, params);

    copied += batch.length;
    const last = batch[batch.length - 1];
    lastKey = pk.map((c) => last[c]);
  }

  return { columns: sourceColumns, copied };
}

// Compares per-column content, not only row counts: non-null values everywhere, and the
// number of JSON elements (array items / object keys) in JSON columns
async function verifyContent(my, pg, table, columns) {
  const myExprs = [];
  const pgExprs = [];
  for (const c of columns) {
    myExprs.push(`COUNT(\`${c}\`)`);
    pgExprs.push(`COUNT("${c}")`);
    if (JSON_COLUMNS.has(c)) {
      myExprs.push(`COALESCE(SUM(JSON_LENGTH(\`${c}\`)), 0)`);
      // same semantics as MySQL JSON_LENGTH(): NULL for SQL NULL, 1 for a scalar
      pgExprs.push(`COALESCE(SUM(CASE
        WHEN "${c}" IS NULL THEN NULL
        WHEN jsonb_typeof("${c}") = 'array' THEN jsonb_array_length("${c}")
        WHEN jsonb_typeof("${c}") = 'object' THEN (SELECT COUNT(*) FROM jsonb_object_keys("${c}"))
        ELSE 1 END), 0)`);
    } else if (BOOLEAN_COLUMNS.has(c)) {
      myExprs.push(`COALESCE(SUM(\`${c}\` <> 0), 0)`);
      pgExprs.push(`COUNT(*) FILTER (WHERE "${c}")`);
    }
  }
  const [[myRow]] = await my.query({ sql: `SELECT ${myExprs.join(", ")} FROM \`${table}\``, rowsAsArray: true });
  const { rows } = await pg.query({ text: `SELECT ${pgExprs.join(", ")} FROM "${table}"`, rowMode: "array" });
  const pgRow = rows[0];
  const diffs = [];
  myRow.forEach((value, i) => {
    if (Number(value) !== Number(pgRow[i])) {
      diffs.push(`${myExprs[i]}: mysql=${value} pg=${pgRow[i]}`);
    }
  });
  if (diffs.length > 0) {
    throw new Error(`${table}: content mismatch: ${diffs.join("; ")}`);
  }
}

async function main() {
  const my = await mysql.createConnection({
    host: requireEnv("MYSQL_HOST"),
    port: Number(process.env.MYSQL_PORT || 3306),
    user: requireEnv("MYSQL_USER"),
    password: requireEnv("MYSQL_PASSWORD"),
    database: requireEnv("MYSQL_DATABASE"),
    // Keep DATETIME/TIMESTAMP/DATE as raw strings: no JS timezone conversion on the way through
    dateStrings: true,
    timezone: "Z",
    supportBigNumbers: true,
    charset: "utf8mb4",
  });

  const pg = new Client({
    host: requireEnv("PG_HOST"),
    port: Number(process.env.PG_PORT || 5432),
    user: requireEnv("PG_USER"),
    password: requireEnv("PG_PASSWORD"),
    database: requireEnv("PG_DATABASE"),
    // Managed Postgres needs TLS; its CA is not in the default trust store
    ssl: process.env.PG_SSL === "disable" ? false : { rejectUnauthorized: false },
  });
  await pg.connect();

  try {
    // DATETIME has no zone: reading it as UTC is only correct if the MySQL zone is UTC.
    // Abort instead of shifting data.
    const [[tz]] = await my.query("SELECT @@session.time_zone AS session_tz, @@system_time_zone AS system_tz");
    console.log(`MySQL time zone: session=${tz.session_tz} system=${tz.system_tz}`);
    const isUtc = (zone) => ["UTC", "+00:00", "Etc/UTC"].includes(zone);
    if (!(isUtc(tz.session_tz) || (tz.session_tz === "SYSTEM" && isUtc(tz.system_tz)))) {
      throw new Error("MySQL session time zone is not UTC; date values would be shifted");
    }
    await pg.query("SET TIME ZONE 'UTC'");

    await applyMigrations(pg);

    const tables = Object.keys(TABLES);
    const existing = [];
    for (const table of tables) {
      const { rows } = await pg.query(`SELECT COUNT(*)::int AS cnt FROM "${table}"`);
      if (rows[0].cnt > 0) {
        existing.push(`${table}=${rows[0].cnt}`);
      }
    }
    if (existing.length > 0) {
      console.log(`Postgres already has rows: ${existing.join(", ")}`);
      if (!FORCE) {
        throw new Error("Refusing to truncate non-empty Postgres tables without FORCE=1");
      }
    }

    await pg.query("BEGIN");
    await pg.query(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY`);

    const summary = [];
    for (const table of tables) {
      const started = Date.now();
      const { columns, copied } = await copyTable(my, pg, table);
      const [[{ cnt: mysqlCount }]] = await my.query(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
      const { rows } = await pg.query(`SELECT COUNT(*)::int AS cnt FROM "${table}"`);
      summary.push({ table, mysqlCount: Number(mysqlCount), copied, pgCount: rows[0].cnt, seconds: (Date.now() - started) / 1000 });
      await verifyContent(my, pg, table, columns);

      // setval is not transactional, so a dry run must not touch sequences.
      // Only SERIAL id tables have one; pg_get_serial_sequence() throws for a missing column.
      if (TABLES[table].join() !== "id" || DRY_RUN) {
        continue;
      }
      const { rows: seqRows } = await pg.query("SELECT pg_get_serial_sequence($1, 'id') AS seq", [table]);
      if (seqRows[0]?.seq) {
        await pg.query(
          `SELECT setval($1, COALESCE((SELECT MAX(id) FROM "${table}"), 1), (SELECT MAX(id) IS NOT NULL FROM "${table}"))`,
          [seqRows[0].seq]
        );
      }
    }

    console.table(summary);
    const mismatches = summary.filter((s) => s.mysqlCount !== s.pgCount || s.copied !== s.pgCount);
    if (mismatches.length > 0) {
      throw new Error(`Row count mismatch: ${mismatches.map((m) => m.table).join(", ")}`);
    }
    console.log("Per-column content (non-null counts, JSON element counts, booleans) matches MySQL");
    console.log(`Peak RSS: ${Math.round(process.resourceUsage().maxRSS / 1024)} MB`);

    if (DRY_RUN) {
      await pg.query("ROLLBACK");
      console.log("DRY_RUN=1: copy verified and rolled back (schema migrations stay applied)");
    } else {
      await pg.query("COMMIT");
      console.log("Data copy committed");
    }
  } catch (err) {
    await pg.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await my.end();
    await pg.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
