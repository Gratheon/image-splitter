import {sql} from "@databases/mysql";

import {logger} from '../logger';
import {storage} from "./storage";
import fileModel from './file';
import * as imageModel from "../models/image";

import {MIN_VARROA_CONFIDENCE} from "../workers/detectVarroa";
import {roundToDecimal} from "../workers/common/common";
import {Path} from "../path";
import URL from "../url";
import { generateChannelName, publisher } from '../redisPubSub';


let typeMap = {
    'BEE_WORKER': '0',
    'BEE_DRONE': '1',
    'BEE_WORKER_ALTERNATE': '2',
    'BEE_QUEEN': '3'
}


export type CutPosition = {
    x: number
    y: number
    width: number
    height: number
    left: number
    top: number
    maxCutsX: number
    maxCutsY: number
}

export type DetectedObject = {
    n: String, // class. 10 - queen cup. 11 - varroa
    x: number
    y: number
    w: number
    h: number
    c: number // confidence
}

export type FrameSideFetchedByFileId = {
    user_id: number
    file_id: number
    frame_side_id: number
    filename: string
    width: number
    height: number
    hash: string
    url_version: number
    ext: string

    localFilePath: Path
    url: URL

    imageBytes?: Buffer
}

// Beehive frames have sides
// For every side we detect bees
// We also allow drawing with ipad pencil on it - strokeHistory
//
const frameSideModel = {
    getFrameSides: async function (frameSideIds = [], inspectionId, uid) {
        let result;

        if (frameSideIds.length === 0) {
            result = await storage().query(
                sql`SELECT t1.inspection_id as inspectionId,
                           t1.frame_side_id as frameSideId
                    FROM files_frame_side_rel t1
                    WHERE t1.user_id = ${uid}
                      AND t1.inspection_id = ${inspectionId}`
            );
        } else {
            result = await storage().query(
                sql`SELECT t1.inspection_id as inspectionId,
                           t1.frame_side_id as frameSideId
                    FROM files_frame_side_rel t1
                    WHERE t1.frame_side_id IN (${frameSideIds})
                      AND t1.user_id = ${uid}
                      AND t1.inspection_id = ${inspectionId}`
            );
        }

        return result;
    },

    getFrameSideByFileId: async function (file_id: string) : Promise<FrameSideFetchedByFileId | null> { // Allow null return type
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
                FROM files_frame_side_rel t1
                LEFT JOIN files t2 ON t1.file_id = t2.id
                WHERE t1.file_id = ${file_id}
                ORDER BY t1.added_time ASC
                LIMIT 1`
        );

        const file = result[0];

        if (!file) {
            return null;
        }

        file.url = fileModel.getUrl(file);
        file.localFilePath = imageModel.getOriginalFileLocalPath(file.user_id, file.filename)
        file.width = Number(file.width);
        file.height = Number(file.height);

        return file;
    },

    getLastestByFrameSideId: async function (frameSideId: number, uid: number) {
        //t1.detected_bees
        const result = await storage().query(
            sql`SELECT t1.user_id,
                       t1.strokeHistory,
                       t1.queen_detected,
                       t1.is_queen_confirmed, -- Fetch the new column
                       t2.filename,
                       t2.width,
                       t2.height,
                       t2.id as fileId,
                       t4.cups
                FROM files_frame_side_rel t1
                         LEFT JOIN files t2 ON t1.file_id = t2.id
                         LEFT JOIN files_frame_side_queen_cups t4 ON t1.file_id = t4.file_id
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                  AND t1.inspection_id IS NULL
                ORDER BY t1.added_time DESC
                LIMIT 1`
        );

        const rel = result[0];

        if (!rel) {
            return null;
        }

        const file = await fileModel.getById(rel.fileId, uid);
        const detectedBees = await frameSideModel.getDetectedBeesAndQueensFromLatestFile(frameSideId, uid)

        return {
            __typename: 'FrameSideFile', // This might need adjustment if the resolver returns FrameSide now
            id: rel.id, // This ID might be ambiguous (files_frame_side_rel.id vs frame_side.id)
            frameSideId,
            strokeHistory: rel.strokeHistory,
            file: file,
            detectedBees: detectedBees,
            detectedCells: rel.cells, // cells not selected
            detectedQueenCups: rel.cups,
            queenDetected: !!rel.queen_detected, // Ensure boolean
            isQueenConfirmed: !!rel.is_queen_confirmed // Ensure boolean
        };
    },

    updateDetectedBees: async function (detectedBees: DetectedObject[], fileId, frameSideId, uid) {
        const workerBeeCount = frameSideModel.countDetectedWorkerBees(detectedBees)
        const detectedDrones = frameSideModel.countDetectedDrones(detectedBees)

        // Update detected bees atomically using JSON_MERGE_PRESERVE
        // This avoids the read-modify-write race condition between concurrent part processors.
        // Note: Requires MySQL 5.7.22+ or 8.0.3+
        // If using older MySQL, might need JSON_EXTRACT + JSON_ARRAY_APPEND approach.
        await storage().query(sql`
            UPDATE files_frame_side_rel
            SET
                detected_bees = JSON_MERGE_PRESERVE(
                    COALESCE(detected_bees, JSON_ARRAY()), -- Ensure target is a JSON array, default to [] if NULL
                    ${JSON.stringify(detectedBees)}       -- Array of new bees to append
                ),
                worker_bee_count = IFNULL(worker_bee_count, 0) + ${workerBeeCount},
                drone_count      = IFNULL(drone_count, 0) + ${detectedDrones}
            WHERE file_id = ${fileId}
              AND frame_side_id = ${frameSideId}
              AND user_id = ${uid}
        `);

        logger.info(`Atomically updated detected bees in DB, incremented counts`, {
            fileId,
            frameSideId,
            uid,
            newBeesCount: detectedBees.length, // Log how many bees were attempted to be added in this call
            workerBeeCount, // Count increment for this batch
            detectedDrones, // Count increment for this batch
        });

        // No transaction needed here as the single UPDATE is atomic per row.
        return true;
    },

    updateDetectedDrones: async function (detectedDrones: DetectedObject[], fileId, frameSideId, uid) {
        const droneCount = detectedDrones.length;

        logger.info(`Attempting to update detected drones in DB`, {
            fileId,
            frameSideId,
            uid,
            dronesBeingAdded: detectedDrones.length,
            dronesData: JSON.stringify(detectedDrones)
        });

        const result = await storage().query(sql`
            UPDATE files_frame_side_rel
            SET
                detected_drones = JSON_MERGE_PRESERVE(
                    COALESCE(detected_drones, JSON_ARRAY()),
                    ${JSON.stringify(detectedDrones)}
                ),
                drone_count = IFNULL(drone_count, 0) + ${droneCount}
            WHERE file_id = ${fileId}
              AND frame_side_id = ${frameSideId}
              AND user_id = ${uid}
        `);

        logger.info(`Atomically updated detected drones in DB`, {
            fileId,
            frameSideId,
            uid,
            newDronesCount: detectedDrones.length,
            droneCount,
            affectedRows: result.affectedRows
        });

        if (result.affectedRows === 0) {
            logger.warn(`No rows updated when storing drones - record may not exist`, {
                fileId,
                frameSideId,
                uid
            });
        }

        return true;
    },

    updateDetectedVarroa: async function (detectedVarroa, fileId, frameSideId, uid) {
    let logCtx = {fileId, frameSideId, uid}
    // The 'detectedVarroa' passed here should already be the final, deduplicated list
    const finalVarroaCount = detectedVarroa.length; // Calculate count from the final list
    logger.info('Updating detected varroa in DB', {...logCtx, finalVarroaCount});

    // Overwrite the column with the final list and set the count directly
    await storage().query(
        sql`UPDATE files_frame_side_rel
            SET detected_varroa=${JSON.stringify(detectedVarroa)},
                varroa_count   = ${finalVarroaCount}
            WHERE file_id = ${fileId}
              AND frame_side_id = ${frameSideId}
              AND user_id = ${uid}`
        );
        return true;
    },

    getDetectedBees: async function (tx, frameSideId, fileId, uid): Promise<DetectedObject[]> {
        const result = await tx.query(
            sql`SELECT detected_bees
                FROM files_frame_side_rel
                WHERE file_id = ${fileId}
                  AND frame_side_id = ${frameSideId}
                  AND user_id = ${uid}
                LIMIT 1`
        );
        const rel = result[0];
        if (!rel || !rel.detected_bees) { return []; }
        return rel.detected_bees;
    },

    getDetectedBeesAndQueensFromLatestFile: async function (frameSideId, uid): Promise<DetectedObject[]> {
        const result = await storage().query(
            sql`SELECT detected_bees, detected_queens
                FROM files_frame_side_rel
                WHERE frame_side_id = ${frameSideId}
                  AND user_id = ${uid}
                  AND inspection_id IS NULL
                ORDER BY added_time DESC
                LIMIT 1`
        );
        const rel = result[0];
        if (!rel) { return []; }
        const bees = rel.detected_bees || [];
        const queens = rel.detected_queens || [];
        return [...queens, ...bees];
    },

    getDetectedVarroa: async function (frameSideId, uid) {
        const result = await storage().query(
            sql`SELECT t1.detected_varroa
                FROM files_frame_side_rel t1
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                  AND t1.inspection_id IS NULL
                ORDER BY t1.added_time DESC
                LIMIT 1`
        );
        const rel = result[0];
        return rel ? rel.detected_varroa : null;
    },

    getDetectedDrones: async function (frameSideId, uid) {
        const result = await storage().query(
            sql`SELECT t1.detected_drones
                FROM files_frame_side_rel t1
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                  AND t1.inspection_id IS NULL
                ORDER BY t1.added_time DESC
                LIMIT 1`
        );
        const rel = result[0];
        return rel ? rel.detected_drones : null;
    },

    getDetectedCells: async function (frameSideId, uid) {
        // This likely needs adjustment if cells are stored per file relation
        const result = await storage().query(
            sql`SELECT t1.cells
                FROM files_frame_side_cells t1
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                  -- AND t1.inspection_id IS NULL -- Assuming cells are linked to the latest
                ORDER BY t1.added_time DESC -- Assuming added_time exists
                LIMIT 1`
        );
        const rel = result[0];
        return rel ? rel.cells : null;
    },

    getWorkerBeeCount: async function (frameSideId, uid) {
        const result = await storage().query(
            sql`SELECT t1.worker_bee_count
                FROM files_frame_side_rel t1
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                  AND t1.inspection_id IS NULL
                ORDER BY t1.added_time DESC
                LIMIT 1`
        );
        const rel = result[0];
        return rel ? rel.worker_bee_count : null;
    },

    getVarroaCount: async function (frameSideId, uid) {
        const result = await storage().query(
            sql`SELECT t1.varroa_count
                FROM files_frame_side_rel t1
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                  AND t1.inspection_id IS NULL
                ORDER BY t1.added_time DESC
                LIMIT 1`
        );
        const rel = result[0];
        return rel ? rel.varroa_count : null;
    },

    getDroneCount: async function (frameSideId, uid) {
        const result = await storage().query(
            sql`SELECT t1.drone_count
                FROM files_frame_side_rel t1
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                  AND t1.inspection_id IS NULL
                ORDER BY t1.added_time DESC
                LIMIT 1`
        );
        const rel = result[0];
        return rel ? rel.drone_count : null;
    },

    getQueenCount: async function (frameSideId, uid) {
        const result = await storage().query(
            sql`SELECT t1.queen_count
                FROM files_frame_side_rel t1
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                  AND t1.inspection_id IS NULL
                ORDER BY t1.added_time DESC
                LIMIT 1`
        );
        const rel = result[0];
        return rel ? rel.queen_count : null;
    },

    // Fetches the AI detected status
    getQueenPresence: async function (frameSideId, uid): Promise<boolean | null> {
        const result = await storage().query(
            sql`SELECT t1.queen_detected
                FROM files_frame_side_rel t1
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                  AND t1.inspection_id IS NULL
                ORDER BY t1.added_time DESC
                LIMIT 1`
        );
        const rel = result[0];
        if (!rel) { return null; }
        return !!rel.queen_detected;
    },

    // Fetches the user confirmation status from the new column
    getQueenConfirmation: async function (frameSideId, uid): Promise<boolean | null> {
        const result = await storage().query(
            sql`SELECT t1.is_queen_confirmed
                FROM files_frame_side_rel t1
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                  AND t1.inspection_id IS NULL
                ORDER BY t1.added_time DESC
                LIMIT 1`
        );
        const rel = result[0];
        if (!rel) { return null; }
        return !!rel.is_queen_confirmed;
    },

    countDetectedVarroa: function (detectedVarroa: DetectedObject[]): number {
        let cnt = 0
        for (let o of detectedVarroa) {
            if (o.c > MIN_VARROA_CONFIDENCE) { cnt++ }
        }
        return cnt;
    },

    countDetectedWorkerBees: function (detectedBees: DetectedObject[]): number {
        let cnt = 0
        for (let o of detectedBees) {
            if (o.c > 0.5 && (o.n == typeMap.BEE_WORKER || o.n == typeMap.BEE_WORKER_ALTERNATE)) { cnt++ }
        }
        return cnt;
    },

    countDetectedDrones: function (detectedBees: DetectedObject[]): number {
        let cnt = 0
        for (let o of detectedBees) {
            if (o.c > 0.5 && o.n == typeMap.BEE_DRONE) { cnt++ }
        }
        return cnt;
    },

    updateStrokes: async function (fileRels, uid) {
        for (let file of fileRels) {
            await storage().query(
                sql`UPDATE files_frame_side_rel
                    SET strokeHistory=${JSON.stringify(file.strokeHistory)}
                    WHERE file_id = ${file.fileId}
                      AND frame_side_id = ${file.frameSideId}
                      AND user_id = ${uid}`
            );
        }
        return true;
    },

    // Updates the user confirmation status in the new column
    updateQueenConfirmation: async function (frameSideId: string | number, isConfirmed: boolean, uid: string | number) {
        // Ensure IDs are numbers before using in query
        const frameSideIdNum = Number(frameSideId);
        const userIdNum = Number(uid);

        if (isNaN(frameSideIdNum) || isNaN(userIdNum)) {
            logger.error('updateQueenConfirmation: Invalid ID provided', { frameSideId, uid });
            return false; // Or throw an error
        }

        // Update only the latest record for the frame side using correct columns
        await storage().query(
            sql`UPDATE files_frame_side_rel
                SET is_queen_confirmed=${isConfirmed}
                WHERE frame_side_id = ${frameSideIdNum}
                  AND user_id = ${userIdNum}
                  AND inspection_id IS NULL
                ORDER BY added_time DESC
                LIMIT 1`
        );
        // Removed Redis publish for manual confirmation update
        return true;
    },

    // Updated to only set is_queen_confirmed to true if currently false
    updateQueens: async function (queens: DetectedObject[], frameSideId, uid) {
        // 1. Get the latest file relation record for this frameSideId to get file_id and current confirmation status
        const latestRel = await storage().query(
            sql`SELECT file_id, is_queen_confirmed, detected_queens
                 FROM files_frame_side_rel
                 WHERE frame_side_id = ${frameSideId}
                   AND user_id = ${uid}
                   AND inspection_id IS NULL
                 ORDER BY added_time DESC
                 LIMIT 1`
        );

        if (!latestRel || latestRel.length === 0) {
            logger.error('updateQueens: Could not find latest record for frameSideId', { frameSideId, uid });
            return false; // Or throw error
        }
        const currentRecord = latestRel[0];
        const fileId = currentRecord.file_id;
        const isCurrentlyConfirmed = !!currentRecord.is_queen_confirmed;

        // 2. Determine if AI found queens
        const aiFoundQueen = queens && queens.length > 0;

        // Log the values used for conditional update
        logger.info('updateQueens: Checking conditions before update', { frameSideId, fileId, aiFoundQueen, isCurrentlyConfirmed });

        // 3. Prepare updated detected_queens JSON
        let exQueens: DetectedObject[] = currentRecord.detected_queens || [];
        exQueens.push(...queens); // Add new detections

        // 4. Construct and execute the UPDATE query targeting the specific row via file_id, frame_side_id, user_id
        await storage().query(
            sql`UPDATE files_frame_side_rel
                SET detected_queens=${JSON.stringify(exQueens)},
                    queen_count    = IFNULL(queen_count, 0) + ${queens.length},
                    queen_detected = ${aiFoundQueen}
                    ${(aiFoundQueen && isCurrentlyConfirmed === false) ? sql`, is_queen_confirmed = TRUE` : sql``}
                WHERE file_id = ${fileId}
                  AND frame_side_id = ${frameSideId}
                  AND user_id = ${uid}`
        );
        // Removed Redis publish for AI confirmation update
        return true;
    },

    cloneFramesForInspection: async function (frameSideIDs: number[], inspectionId: number, uid: number) {
        await storage().query(
            sql`UPDATE files_frame_side_rel
                SET inspection_id=${inspectionId}
                WHERE inspection_id IS NULL
                  AND frame_side_id IN (${frameSideIDs})
                  AND user_id = ${uid}`
        );
        return true
    },

    getHiveIdFromFrameSides: async function (frameSideIDs: number[], uid: number): Promise<string | null> {
        if (!frameSideIDs || frameSideIDs.length === 0) {
            return null;
        }

        const result = await storage().query(
            sql`SELECT DISTINCT t1.hive_id
                FROM files_hive_rel t1
                INNER JOIN files_frame_side_rel t2 ON t2.file_id = t1.file_id
                WHERE t2.frame_side_id IN (${frameSideIDs})
                  AND t1.user_id = ${uid}
                LIMIT 1`
        );

        return result.length > 0 ? result[0].hive_id : null;
    }
};

export default frameSideModel


export function convertDetectedBeesStorageFormat(txt: string, cutPosition: CutPosition): DetectedObject[] {
    const result: DetectedObject[] = [];
    const lines = txt.split("\n");

    for (let line of lines) {
        if (line.length < 5) continue;

        let [n, x, y, w, h, c] = line.split(' ');

        let w2 = Number(w)
        let x2 = Number(x)
        let y2 = Number(y)
        let h2 = Number(h)

        if (cutPosition.maxCutsX > 0) {
            w2 = Number(w2) / (cutPosition.maxCutsX)
            x2 = (x2 * cutPosition.width + cutPosition.left) / (cutPosition.maxCutsX * cutPosition.width)
        }

        if (cutPosition.maxCutsY > 0) {
            h2 = Number(h2) / (cutPosition.maxCutsY)
            y2 = (Number(y) * cutPosition.height + cutPosition.top) / (cutPosition.maxCutsY * cutPosition.height)
        }

        // skip queen detections coming from models-bee-detector
        // we run a separate model for queen detection in clarifai
        if (n !== typeMap.BEE_QUEEN) {
            result.push({
                n,
                x: roundToDecimal(x2, 5),
                y: roundToDecimal(y2, 5),
                w: roundToDecimal(w2, 4),
                h: roundToDecimal(h2, 4),
                c: roundToDecimal(Number(c), 2)
            });
        }
    }

    return result;
}
