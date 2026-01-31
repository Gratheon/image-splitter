import createConnectionPool, {sql, SQLQuery} from "@databases/mysql";
import * as fs from "fs";
import * as crypto from "crypto";

import config from "../config/index";

export { sql };


let db;
let isConnected = false;
let reconnectInterval: NodeJS.Timeout | null = null;

export function storage() {
  return db;
}

export function isStorageConnected(): boolean {
  return isConnected;
}

async function tryConnect(logger): Promise<boolean> {
  try {
    const dsn = `mysql://${config.mysql.user}:${config.mysql.password}@${config.mysql.host}:${config.mysql.port}/`
    const conn = createConnectionPool(dsn);

    await conn.query(sql`CREATE DATABASE IF NOT EXISTS \`image-splitter\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;`);
    await conn.dispose();

    const startTimes = new Map<SQLQuery, number>();
    let connectionsCount = 0;

    db = createConnectionPool({
      connectionString: `${dsn}${config.mysql.database}`,
      // Connection pool limits to prevent exhaustion
      bigIntMode: 'number',
      poolSize: 20, // Maximum number of connections (default is 10)
      queueTimeoutMilliseconds: 10000, // Wait max 10s for a connection (default is 60s)
      idleTimeoutMilliseconds: 60000, // Close idle connections after 60s (default is 30s)
      maxUses: 5000, // Recycle connections after 5000 uses to prevent leaks
      onQueryError: (query, { text }, err) => {
        startTimes.delete(query);
        logger.error(
          `DB error ${text} - ${err.message}`
        );
      },

      onQueryStart: (query) => {
        startTimes.set(query, Date.now());
      },
      onQueryResults: (query, {text}, results) => {
        const start = startTimes.get(query);
        startTimes.delete(query);

        if (start) {
          logger.debug(`${text.replace(/\n/g," ").replace(/\s+/g, ' ')} - ${Date.now() - start}ms`);
        } else {
          logger.debug(`${text.replace(/\n/g," ").replace(/\s+/g, ' ')}`);
        }
      },
      onConnectionOpened: () => {
        logger.info(
            `Opened connection. Active connections = ${++connectionsCount}`,
        );
      },
      onConnectionClosed: () => {
        logger.info(
            `Closed connection. Active connections = ${--connectionsCount}`,
        );
      },
    });

    process.once('SIGTERM', () => {
      if (reconnectInterval) {
        clearInterval(reconnectInterval);
      }
      db.dispose().catch((ex) => {
        logger.error(ex);
      });
    });

    await migrate(logger);

    isConnected = true;
    logger.info('MySQL connection established successfully');

    if (reconnectInterval) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to connect to MySQL: ${errorMessage}`);
    isConnected = false;
    return false;
  }
}

export async function initStorage(logger) {
  const connected = await tryConnect(logger);

  if (!connected) {
    logger.warn('Initial MySQL connection failed. Will retry every 10 seconds...');

    reconnectInterval = setInterval(async () => {
      logger.info('Attempting to reconnect to MySQL...');
      await tryConnect(logger);
    }, 10000);
  }
}

async function migrate(logger) {
  try {
    await db.query(sql`CREATE TABLE IF NOT EXISTS _db_migrations (
		hash VARCHAR(255),
		filename VARCHAR(255),
		executionTime DATETIME
	  );
`);

    // List the directory containing the .sql files
    const files = await fs.promises.readdir("./migrations");

    // Filter the array to only include .sql files
    const sqlFiles = files.filter((file) => file.endsWith(".sql"));

    // Read each .sql file and execute the SQL statements
    for (const file of sqlFiles) {
      logger.info(`Processing DB migration ${file}`);
      const sqlStatement = await fs.promises.readFile(
        `./migrations/${file}`,
        "utf8"
      );

      // Hash the SQL statements
      const hash = crypto
        .createHash("sha256")
        .update(sqlStatement)
        .digest("hex");

      // Check if the SQL has already been executed by checking the hashes in the dedicated table
      const rows = await db.query(
        sql`SELECT * FROM _db_migrations WHERE hash = ${hash}`
      );

      // If the hash is not in the table, execute the SQL and store the hash in the table
      if (rows.length === 0) {
        await db.tx(async (dbi) => {
          await dbi.query(sql.file(`./migrations/${file}`));
        })

        logger.info(`Successfully executed SQL from ${file}.`);

        // Store the hash in the dedicated table
        await db.query(
          sql`INSERT INTO _db_migrations (hash, filename, executionTime) VALUES (${hash}, ${file}, NOW())`
        );
        logger.info(`Successfully stored hash in executed_sql_hashes table.`);
      } else {
        logger.info(`SQL from ${file} has already been executed. Skipping.`);
      }
    }
  } catch (err) {
    logger.error(err);
  }
}
