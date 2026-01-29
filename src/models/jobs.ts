import { logger } from "../logger";
import { storage } from "./storage";
import { sql } from "@databases/mysql";
import { publisher, subscriber } from "../redisPubSub";

export const TYPE_RESIZE = "resize";

export const TYPE_CUPS = "cups";
export const TYPE_CELLS = "cells";
export const TYPE_QUEENS = "queens";
export const TYPE_VARROA = "varroa";
export const TYPE_VARROA_BOTTOM = "varroa_bottom";
export const TYPE_BEES = "bees";
export const TYPE_DRONES = "drones";

export const NOTIFY_JOB = "notify";

const ERROR_TIME_RETRY_MS = 30 * 1000;
const IDLE_TIME_RETRY_MS = 10 * 1000;
const WORK_TIME_RETRY_MS = 10;

type Job = {
  id: number;
  name: string;
  ref_id: number;
  process_start_time: Date;
  process_end_time: Date;
  payload: any;
  error: string;
  priority: number;
};

interface ProcessFn {
  (refId: number, payload: any): Promise<void>;
}

const jobsModel = {
  /**
   * Fetches the oldest unprocessed job of the given type
   * - We lock the job by setting process_start_time, thats why
   * process_start_time is older than 1 minute
   * - We allow only 3 calls to the job (2 retries) to prevent infinite calls
   * - Jobs are ordered by priority (lower number = higher priority) then by ID
   * @param name
   */
  fetchUnprocessed: async function (tx, name: string) {
    const jobs = await tx.query(
      sql`SELECT *
                FROM jobs
                WHERE name = ${name}
                  AND ( (process_start_time <= NOW() - INTERVAL 1 MINUTE) OR process_start_time IS NULL)
                  AND process_end_time IS NULL
                  AND (calls < 3)
                ORDER BY priority ASC, id ASC
                LIMIT 1`,
    );

    if (jobs.length === 0) {
      return null;
    }

    return jobs[0];
  },

  addJob: async function (name: string, refId: number, resizePayload = {}, priority = 5) {
    await storage().query(
      sql`INSERT INTO jobs (name, ref_id, payload, priority)
      VALUES (${name}, ${refId}, ${JSON.stringify(resizePayload)}, ${priority})`,
    );
    
    // Notify workers via Redis that a new job is available
    try {
      await publisher().publish(`jobs:new:${name}`, JSON.stringify({ refId, priority }));
    } catch (e) {
      logger.error(`Failed to publish job notification to Redis for ${name}`, e);
      // Don't fail the job creation if Redis publish fails
    }
  },

  startDetection: async function (tx, name: string, refId: number) {
    logger.info(`starting job`, { name, refId });
    await tx.query(
      sql`UPDATE jobs
                SET process_start_time=NOW()
                WHERE name = ${name}
                  AND ref_id = ${refId}`,
    );
  },

  endDetection: async function (name: string, refId: number) {
    logger.info(`ending job`, { name, refId });
    await storage().query(
      sql`UPDATE jobs
                SET process_end_time=NOW()
                WHERE name = ${name}
                  AND ref_id = ${refId}`,
    );
  },

  fail: async function (job: Job, error: any) {
    logger.info(`failing job`, { job });
    await storage().query(
      sql`UPDATE jobs
                SET process_end_time=NOW(),
                    error=${JSON.stringify(error)},
                    calls=calls + 1
                WHERE id = ${job.id}`,
    );
  },

  isComplete: async function (name: string, refId: number) {
    const result = await storage().query(
      sql`SELECT process_end_time
                FROM jobs
                WHERE name = ${name}
                  AND ref_id = ${refId}
                LIMIT 1`,
    );

    const rel = result[0];

    if (!rel) {
      // If no job record exists, it cannot be complete.
      return false;
    }

    return rel.process_end_time !== null;
  },

  /**
   * Process jobs using Redis pub/sub for instant notifications instead of polling
   * Workers subscribe to Redis channels and are notified immediately when jobs are added
   * @param name - Job type name
   * @param fn - Processing function
   * @param rateLimitMs - Optional delay between job processing (for rate limiting external APIs)
   */
  processJobInLoop: async function (name: string, fn: ProcessFn, rateLimitMs = 0) {
    const sub = subscriber();
    const channelName = `jobs:new:${name}`;
    
    // Subscribe to job notifications
    await sub.subscribe(channelName);
    
    logger.info(`Worker for ${name} subscribed to ${channelName}`);
    
    // On startup, check for any existing jobs in DB
    await jobsModel.checkAndProcessJob(name, fn, rateLimitMs);
    
    // Listen for new job notifications
    sub.on('message', async (channel, message) => {
      if (channel === channelName) {
        logger.debug(`Worker ${name} received notification`, { message });
        await jobsModel.checkAndProcessJob(name, fn, rateLimitMs);
      }
    });
  },

  /**
   * Separate method to check DB and process a single job
   * After completing a job, it checks if there are more jobs to process
   * This allows batch processing without waiting for Redis notifications
   */
  checkAndProcessJob: async function (name: string, fn: ProcessFn, rateLimitMs = 0) {
    let job;

    await storage().tx(async (tx) => {
      job = await jobsModel.fetchUnprocessed(tx, name);

      if (job != null) {
        await jobsModel.startDetection(tx, name, job.ref_id);
      }
    });

    if (job == null) {
      logger.debug(`No pending jobs for ${name}`);
      return;
    }

    // Rate limiting: wait before processing (for external API calls)
    if (rateLimitMs > 0) {
      logger.debug(`Rate limiting ${name} job for ${rateLimitMs}ms`);
      await new Promise(resolve => setTimeout(resolve, rateLimitMs));
    }

    // Process job
    try {
      logger.info(`Processing job ${name}`, { ref_id: job.ref_id, priority: job.priority });
      await fn(job.ref_id, job.payload);
    } catch (e) {
      logger.errorEnriched(
        `Processing job ${name} with ref_id=${job.ref_id} failed`,
        e
      );
      await jobsModel.fail(job, e);
      
      // After failure, check if there are more jobs (with error delay)
      setTimeout(() => {
        jobsModel.checkAndProcessJob(name, fn, rateLimitMs);
      }, ERROR_TIME_RETRY_MS);
      return;
    }

    await jobsModel.endDetection(name, job.ref_id);
    
    // After completing one job, immediately check if there are more
    // This allows processing multiple jobs without waiting for Redis notification
    setImmediate(() => {
      jobsModel.checkAndProcessJob(name, fn, rateLimitMs);
    });
  },
};

export default jobsModel;
