import {logger} from "../logger";
import {storage} from "./storage";
import {sql} from "@databases/mysql";

export const TYPE_CUPS = 'cups';
export const TYPE_CELLS = 'cells';
export const TYPE_QUEENS = 'queens';
export const TYPE_VARROA = 'varroa';
export const TYPE_BEES = 'bees';

export default {
    startDetection: async function (type: string, refId: number) {
        logger.info(`starting job`, {type, refId});
        await storage().query(
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


    isComplete: async function (type: string, refId: number) {
        const result = await storage().query(
            sql`SELECT process_end_time
			FROM jobs
			WHERE type = ${type} AND ref_id = ${refId}
			LIMIT 1`
        );

        const rel = result[0];

        if (!rel) {
            return true;
        }

        return rel.process_end_time ? true : false;
    },
}