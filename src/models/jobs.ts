import {logger} from "../logger";
import {storage} from "./storage";
import {sql} from "@databases/mysql";
import {log} from "console";

export const TYPE_CUPS = 'cups';
export const TYPE_CELLS = 'cells';
export const TYPE_QUEENS = 'queens';
export const TYPE_VARROA = 'varroa';
export const TYPE_BEES = 'bees';
export const TYPE_RESIZE = 'resize';

type Job = {
    id: number,
    type: string,
    ref_id: number,
    process_start_time: Date,
    process_end_time: Date,
    payload: any,
    error: string,
}

interface ProcessFn {
    (refId: number, payload: any): Promise<void>;
}

const jobsModel = {
    /**
     * Fetches the oldest unprocessed job of the given type
     * - We lock the job by setting process_start_time, thats why
     * process_start_time is older than 1 minute
     * - We allow only 3 calls to the job (2 retries) to prevent infinite calls
     * @param type
     */
    fetchUnprocessed: async function (tx, type: string) {
        const jobs = await tx.query(
            sql`SELECT *
                FROM jobs
                WHERE type = ${type}
                  AND ( (process_start_time <= NOW() - INTERVAL 1 MINUTE) OR process_start_time IS NULL)
                  AND process_end_time IS NULL
                  AND (calls < 3)
                ORDER BY id ASC
                LIMIT 1`
        );

        if(jobs.length === 0) {
            return null;
        }

        return jobs[0];
    },

    addJob: async function (type: string, refId: number, resizePayload = {}) {
        await storage().query(
            sql`INSERT INTO jobs (type, ref_id, payload)
                VALUES (${type}, ${refId}, ${JSON.stringify(resizePayload)})`
        );
    },

    startDetection: async function (tx, type: string, refId: number) {
        logger.info(`starting job`, {type, refId});
        await tx.query(
            sql`UPDATE jobs
                SET process_start_time=NOW()
                WHERE type = ${type}
                  AND ref_id = ${refId}`
        );
    },

    endDetection: async function (type: string, refId: number) {
        logger.info(`ending job`, {type, refId});
        await storage().query(
            sql`UPDATE jobs
                SET process_end_time=NOW()
                WHERE type = ${type}
                  AND ref_id = ${refId}`
        );
    },

    fail: async function (job: Job, error: any) {
        logger.info(`failing job`, {job});
        await storage().query(
            sql`UPDATE jobs
                SET process_end_time=NOW(),
                    error=${JSON.stringify(error)},
                    calls=calls + 1
                WHERE id = ${job.id}`
        );
    },

    isComplete: async function (type: string, refId: number) {
        const result = await storage().query(
            sql`SELECT process_end_time
                FROM jobs
                WHERE type = ${type}
                  AND ref_id = ${refId}
                LIMIT 1`
        );

        const rel = result[0];

        if (!rel) {
            return true;
        }

        return rel.process_end_time ? true : false;
    },

    processJobInLoop: async function (type: string, fn: ProcessFn) {
        let job;

        await storage().tx(async (tx) => {
            job = await jobsModel.fetchUnprocessed(tx, type)

            if (job != null) {
                await jobsModel.startDetection(tx, type, job.ref_id);
            }
        })

        if (job == null) {
            setTimeout(() => {
                jobsModel.processJobInLoop(type, fn);
            }, IDLE_TIME_RETRY_MS);
            return;
        }

        // process job
        try {
            logger.info(`starting job ${type} loop`);
            await fn(job.ref_id, job.payload);
        } catch (e) {
            console.error(e)
            logger.error(`processing job ${type} with ref_id=${job.ref_id} failed`, e);
            await jobsModel.fail(job, e);

            setTimeout(() => {
                jobsModel.processJobInLoop(type, fn);
            }, ERROR_TIME_RETRY_MS);

            // do not consider error as a finished job
            return;
        }

        await jobsModel.endDetection(type, job.ref_id);

        setTimeout(() => {
            jobsModel.processJobInLoop(type, fn);
        }, WORK_TIME_RETRY_MS);
    }
}

const ERROR_TIME_RETRY_MS = 30 * 1000;
const IDLE_TIME_RETRY_MS = 1000;
const WORK_TIME_RETRY_MS = 10;

export default jobsModel;