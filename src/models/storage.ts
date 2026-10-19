import createConnectionPool, {sql, SQLQuery} from "@databases/pg";
import * as fs from "fs";
import * as crypto from "crypto";

import config from "../config/index";
import { recordDbQuery } from "../metrics";

export { sql };


let db;
let isConnected = false;
let reconnectInterval: NodeJS.Timeout | null = null;
const MAX_TRACKED_DB_QUERY_SHAPES = 100;
const trackedQueryShapes = new Set<string>();

function normalizeQueryShape(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const withoutSingleQuoted = collapsed.replace(/'(?:\\'|''|[^'])*'/g, "?");
  const withoutDoubleQuoted = withoutSingleQuoted.replace(/"(?:\\"|""|[^"])*"/g, "?");
  const withoutHex = withoutDoubleQuoted.replace(/\b0x[0-9a-fA-F]+\b/g, "?");
  const withoutNumbers = withoutHex.replace(/\b\d+(?:\.\d+)?\b/g, "?");
  const normalized = withoutNumbers.toLowerCase().slice(0, 180);

  if (trackedQueryShapes.has(normalized)) {
    return normalized;
  }

  if (trackedQueryShapes.size >= MAX_TRACKED_DB_QUERY_SHAPES) {
    return "__other__";
  }

  trackedQueryShapes.add(normalized);
  return normalized;
}

function extractStatementType(text: string): string {
  const statement = text.trim().split(/\s+/)[0]?.toUpperCase();
  return statement || "UNKNOWN";
}

export function storage() {
  return db;
}

export function isStorageConnected(): boolean {
  return isConnected;
}

let connecting = false;

async function tryConnect(logger): Promise<boolean> {
  // Reconnect attempts can outlive the 10s interval (connect timeout + migrations): never overlap them
  if (connecting) {
    return false;
  }
  connecting = true;

  let pool;
  try {
    const { user, password, host, port, database, ssl } = config.postgres;

    // WHY: unlike MySQL, Postgres has no CREATE DATABASE IF NOT EXISTS, and the prod
    // database lives on a managed cluster where it is provisioned manually.
    const startTimes = new Map<SQLQuery, bigint>();
    let connectionsCount = 0;

    pool = createConnectionPool({
      connectionString: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`,
      // DigitalOcean managed Postgres requires TLS ("require" in prod); "prefer" also works with a local container without TLS
      ssl: ssl as any,
      bigIntMode: 'number',
      poolSize: 20, // workers + resolvers share the pool
      queueTimeoutMilliseconds: 10000, // Wait max 10s for a connection (default is 60s)
      idleTimeoutMilliseconds: 60000, // Close idle connections after 60s (default is 30s)
      maxUses: 5000, // Recycle connections after 5000 uses to prevent leaks
      onError: (err) => {
        logger.error(`Postgres connection pool error: ${err.message}`);
      },
      onQueryError: (query, { text }, err) => {
        const start = startTimes.get(query);
        startTimes.delete(query);
        const durationSeconds = start
            ? Number(process.hrtime.bigint() - start) / 1_000_000_000
            : 0;
        const queryShape = normalizeQueryShape(text);
        const statementType = extractStatementType(text);

        recordDbQuery({
          statementType,
          queryShape,
          status: "error",
          durationSeconds,
        });

        logger.error(
          `DB error ${text} - ${err.message}`
        );
      },

      onQueryStart: (query) => {
        startTimes.set(query, process.hrtime.bigint());
      },
      onQueryResults: (query, {text}, results) => {
        const start = startTimes.get(query);
        startTimes.delete(query);
        const durationSeconds = start
            ? Number(process.hrtime.bigint() - start) / 1_000_000_000
            : 0;
        const queryShape = normalizeQueryShape(text);
        const statementType = extractStatementType(text);

        recordDbQuery({
          statementType,
          queryShape,
          status: "success",
          durationSeconds,
        });

        if (start) {
          logger.debug(`${text.replace(/\n/g," ").replace(/\s+/g, ' ')} - ${Math.round(durationSeconds * 1000)}ms`);
        } else {
          logger.debug(`${text.replace(/\n/g," ").replace(/\s+/g, ' ')}`);
        }
      },
      onConnectionOpened: () => {
        logger.debug(
            `Opened connection. Active connections = ${++connectionsCount}`,
        );
      },
      onConnectionClosed: () => {
        logger.debug(
            `Closed connection. Active connections = ${--connectionsCount}`,
        );
      },
    });

    await migrate(pool, logger);

    // Published only after migrations succeeded, so requests never see a half-migrated schema
    db = pool;
    isConnected = true;
    logger.info('Postgres connection established successfully');

    if (reconnectInterval) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to connect to Postgres: ${errorMessage}`);
    isConnected = false;
    // Drop the failed pool so periodic retries do not leak connections
    await pool?.dispose().catch(() => {});
    return false;
  } finally {
    connecting = false;
  }
}

export async function initStorage(logger) {
  process.once('SIGTERM', () => {
    if (reconnectInterval) {
      clearInterval(reconnectInterval);
    }
    db?.dispose().catch((ex) => {
      logger.error(ex);
    });
  });

  const connected = await tryConnect(logger);

  if (!connected) {
    logger.warn('Initial Postgres connection failed. Will retry every 10 seconds...');

    reconnectInterval = setInterval(async () => {
      logger.info('Attempting to reconnect to Postgres...');
      await tryConnect(logger);
    }, 10000);
  }
}

async function migrate(db, logger) {
  await db.query(sql`CREATE TABLE IF NOT EXISTS _db_migrations (
    hash VARCHAR(255),
    filename VARCHAR(255),
    execution_time TIMESTAMPTZ
  );`);

  const files = await fs.promises.readdir("./migrations");

  // Sorted so that migrations run in a deterministic order (readdir order is not guaranteed)
  const sqlFiles = files
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of sqlFiles) {
    logger.info(`Processing DB migration ${file}`);
    const sqlStatement = await fs.promises.readFile(`./migrations/${file}`, "utf8");

    const hash = crypto
      .createHash("sha256")
      .update(sqlStatement)
      .digest("hex");

    // Matched by filename too: editing an applied migration does NOT re-run it, add a new file instead
    const rows = await db.query(
      sql`SELECT * FROM _db_migrations WHERE filename = ${file} OR hash = ${hash} LIMIT 1`
    );

    if (rows.length === 0) {
      // Postgres supports transactional DDL, so a failed migration leaves no partial schema behind
      await db.tx(async (dbi) => {
        await dbi.query(sql.file(`./migrations/${file}`));
        await dbi.query(
          sql`INSERT INTO _db_migrations (hash, filename, execution_time) VALUES (${hash}, ${file}, NOW())`
        );
      });

      logger.info(`Successfully executed SQL from ${file}.`);
    } else {
      logger.info(`SQL from ${file} has already been executed. Skipping.`);
    }
  }
  // Errors propagate to tryConnect(): the service reports the DB as disconnected and retries,
  // instead of serving requests against a half-migrated schema
}
