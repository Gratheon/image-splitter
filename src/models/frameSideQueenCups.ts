import {sql} from "@databases/mysql";

import * as imageModel from "../models/image";
import {storage} from "./storage";
import fileModel from './file';
import URL from '../url'
import {Path} from "../path";

// Beehive frame has sides
// For every side, we try to detect types of cells
// Then we store it in DB

type QueenCupsEntry = {
    user_id: number,
    file_id: number,
    frame_side_id: number,
    filename: string,
    width: number,
    height: number,
    hash: string,
    url_version: number,
    ext: string,

    localFilePath: Path,
    url: URL
}

export default {
    getQueenCupsByFileId: async function (file_id: string): Promise<QueenCupsEntry | null> {
        const result = await storage().query(
            sql`SELECT t1.user_id,
                       t1.file_id,
                       t1.frame_side_id,
                       t2.filename,
                       t2.width,
                       t2.height,
                       t2.hash,
                       t2.url_version,
                       t2.ext
                FROM files_frame_side_queen_cups t1
                         LEFT JOIN files t2 ON t1.file_id = t2.id
                WHERE t1.file_id = ${file_id}
                LIMIT 1`
        );

        const file = result[0];

        if (!file) {
            return null;
        }

        file.url = fileModel.getUrl(file);
        file.localFilePath = imageModel.getOriginalFileLocalPath(file.user_id, file.filename);

        return file;
    },

    updateDetectedQueenCups: async function (detections, fileId:number, frameSideId:number) {
        await storage().query(
            sql`UPDATE files_frame_side_queen_cups
                SET cups=${JSON.stringify(detections)}
                WHERE file_id = ${fileId}
                  AND frame_side_id = ${frameSideId}`
        );
        return true;
    },

    addFrameCups: async function (file_id: number, frame_side_id: number, user_id: number) {
        // @ts-ignore
        return (await storage().query(sql`
            INSERT INTO files_frame_side_queen_cups (file_id, frame_side_id, user_id)
            VALUES (${file_id}, ${frame_side_id}, ${user_id});
            SELECT LAST_INSERT_ID() as id;
        `))[0].id;
    },

    cloneFramesForInspection: async function (frameSideIDs: number[], inspectionId: number, uid: number) {
        await storage().query(
            sql`UPDATE files_frame_side_queen_cups
                SET inspection_id=${inspectionId}
                WHERE inspection_id IS NULL
                  AND frame_side_id IN (${frameSideIDs})
                  AND user_id = ${uid}`
        );

        return true
    }
};