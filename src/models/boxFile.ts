import { sql } from "@databases/mysql";
import { storage } from "./storage";
import { logger } from "../logger";
import config from "../config/index";

export default {
    async addBoxRelation(fileId: number, boxId: number, userId: number, inspectionId: number | null = null) {
        try {
            await storage().query(
                sql`INSERT INTO files_box_rel (file_id, box_id, user_id, inspection_id) 
                    VALUES (${fileId}, ${boxId}, ${userId}, ${inspectionId})`
            );
            logger.info('Added file to box relation', {fileId, boxId, userId, inspectionId});
            return true;
        } catch (err) {
            logger.error('Error adding file to box relation', {err, fileId, boxId, userId});
            throw err;
        }
    },

    async getBoxFiles(boxId: number, userId: number, inspectionId: number | null = null) {
        try {
            const result = inspectionId
                ? await storage().query(
                    sql`SELECT fbr.box_id, fbr.file_id, fbr.user_id, fbr.inspection_id, fbr.added_time,
                               fhr.hive_id,
                               f.hash, f.ext, f.user_id as file_user_id
                       FROM files_box_rel fbr
                       JOIN files f ON f.id = fbr.file_id
                       LEFT JOIN files_hive_rel fhr ON fhr.file_id = fbr.file_id AND fhr.user_id = fbr.user_id
                       WHERE fbr.box_id = ${boxId} 
                         AND fbr.user_id = ${userId} 
                         AND fbr.inspection_id = ${inspectionId}
                       ORDER BY fbr.added_time DESC`
                )
                : await storage().query(
                    sql`SELECT fbr.box_id, fbr.file_id, fbr.user_id, fbr.inspection_id, fbr.added_time,
                               fhr.hive_id,
                               f.hash, f.ext, f.user_id as file_user_id
                       FROM files_box_rel fbr
                       JOIN files f ON f.id = fbr.file_id
                       LEFT JOIN files_hive_rel fhr ON fhr.file_id = fbr.file_id AND fhr.user_id = fbr.user_id
                       WHERE fbr.box_id = ${boxId} 
                         AND fbr.user_id = ${userId} 
                         AND fbr.inspection_id IS NULL
                       ORDER BY fbr.added_time DESC`
                );

            return result.map(row => ({
                ...row,
                url: `${config.aws.url.public}${row.file_user_id}/${row.hash}/original${row.ext ? '.' + row.ext : ''}`
            }));
        } catch (err) {
            logger.error('Error getting box files', {err, boxId, userId, inspectionId});
            throw err;
        }
    }
};

