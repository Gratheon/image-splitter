import { logger } from "../logger";
import { storage } from "./storage";
import { sql } from "@databases/mysql";

export const TYPE_RESIZE = "resize";

export const TYPE_CUPS = "cups";
export const TYPE_CELLS = "cells";
export const TYPE_QUEENS = "queens";
export const TYPE_VARROA = "varroa";
export const TYPE_BEES = "bees";

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
                ORDER BY id ASC
                LIMIT 1`,
    );

    if (jobs.length === 0) {
      return null;
    }

    return jobs[0];
  },

  addJob: async function (name: string, refId: number, resizePayload = {}) {
    await storage().query(
      sql`INSERT INTO jobs (name, ref_id, payload)
      VALUES (${name}, ${refId}, ${JSON.stringify(resizePayload)})`,
    );
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
      return true;
    }

    return rel.process_end_time ? true : false;
  },

  processJobInLoop: async function (name: string, fn: ProcessFn) {
    let job;

    await storage().tx(async (tx) => {
      job = await jobsModel.fetchUnprocessed(tx, name);

      if (job != null) {
        await jobsModel.startDetection(tx, name, job.ref_id);
      }
    });

    if (job == null) {
      setTimeout(() => {
        jobsModel.processJobInLoop(name, fn);
      }, IDLE_TIME_RETRY_MS);
      return;
    }

    // process job
    try {
      logger.info(`starting job ${name} loop`);
      await fn(job.ref_id, job.payload);
    } catch (e) {
      logger.errorEnriched(
        `processing job ${name} with ref_id=${job.ref_id} failed`,
        e,
      );
      await jobsModel.fail(job, e);

      setTimeout(() => {
        jobsModel.processJobInLoop(name, fn);
      }, ERROR_TIME_RETRY_MS);

      // do not consider error as a finished job
      return;
    }

    await jobsModel.endDetection(name, job.ref_id);

    setTimeout(() => {
      jobsModel.processJobInLoop(name, fn);
    }, WORK_TIME_RETRY_MS);
  },
};

export default jobsModel;
