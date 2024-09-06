import {sql} from "@databases/mysql";

import {logger} from '../logger';
import {storage} from "./storage";
import fileModel from './file';
import * as imageModel from "../models/image";

import {MIN_VARROA_CONFIDENCE} from "../workers/detectVarroa";
import {roundToDecimal} from "../workers/common/common";
import {Path} from "../path";
import URL from "../url";


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

    getFrameSideByFileId: async function (file_id: string) : Promise<FrameSideFetchedByFileId> {
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
            __typename: 'FrameSideFile',
            id: rel.id,
            frameSideId,
            strokeHistory: rel.strokeHistory,
            file: file,

            detectedBees: detectedBees, // rel.detected_bees,
            detectedCells: rel.cells,
            detectedQueenCups: rel.cups,

            queenDetected: rel.queen_detected,
        };
    },

    updateDetectedBees: async function (detectedBees: DetectedObject[], fileId, frameSideId, uid) {
        const workerBeeCount = frameSideModel.countDetectedWorkerBees(detectedBees)
        const detectedDrones = frameSideModel.countDetectedDrones(detectedBees)

        // update detected bees in transaction in case of parallelization
        await storage().tx(async (tx) => {
            let exDetectedBees = await frameSideModel.getDetectedBees(tx, frameSideId, fileId, uid)

            logger.info(`updating detected bees in DB, setting counts`, {
                fileId,
                frameSideId,
                uid,
                workerBeeCount,
                detectedDrones,
                // exDetectedBees,
                // detectedBees
            })


            exDetectedBees.push(...detectedBees)

            await tx.query(
                sql`UPDATE files_frame_side_rel
                    SET detected_bees=${JSON.stringify(exDetectedBees)},
                        worker_bee_count = IFNULL(worker_bee_count, 0) + ${workerBeeCount},
                        drone_count      = IFNULL(drone_count, 0) + ${detectedDrones}
                    WHERE file_id = ${fileId}
                      AND frame_side_id = ${frameSideId}
                      AND user_id = ${uid}`
            );
        })
        return true;
    },

    updateDetectedVarroa: async function (detectedVarroa, fileId, frameSideId, uid) {
        let logCtx = {fileId, frameSideId, uid}
        logger.info('detectedVarroa', {...logCtx, detectedVarroa});
        const countDetectedVarroa = frameSideModel.countDetectedVarroa(detectedVarroa)
        let exDetectedVarroa = await frameSideModel.getDetectedVarroa(frameSideId, uid)
        if (!exDetectedVarroa) {
            exDetectedVarroa = []
        }
        exDetectedVarroa.push(...detectedVarroa)

        logger.info(`Updating detected varroa in DB, setting counts`, {...logCtx, countDetectedVarroa})
        await storage().query(
            sql`UPDATE files_frame_side_rel
                SET detected_varroa=${JSON.stringify(exDetectedVarroa)},
                    varroa_count   = IFNULL(varroa_count, 0) + ${countDetectedVarroa}
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

        if (!rel || !rel.detected_bees) {
            return [];
        }

        return rel.detected_bees;
    },

    // frame side can have multiple versions/files attached due to inspections
    getDetectedBeesAndQueensFromLatestFile: async function (frameSideId, uid): Promise<DetectedObject[]> {
        const result = await storage().query(
            sql`SELECT detected_bees, detected_queens
                FROM files_frame_side_rel
                WHERE frame_side_id = ${frameSideId}
                  AND user_id = ${uid}
                ORDER BY added_time DESC
                LIMIT 1`
        );

        const rel = result[0];

        if (!rel) {
            return [];
        }

        if (!rel.detected_queens) {
            return rel.detected_bees
        }

        if (!rel.detected_bees) {
            return rel.detected_queens
        }

        return [
            ...rel.detected_queens,
            ...rel.detected_bees,
        ];
    },

    getDetectedVarroa: async function (frameSideId, uid) {
        const result = await storage().query(
            sql`SELECT t1.detected_varroa
                FROM files_frame_side_rel t1
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                LIMIT 1`
        );

        const rel = result[0];

        if (!rel) {
            return null;
        }

        return rel.detected_varroa;
    },

    getDetectedCells: async function (frameSideId, uid) {
        const result = await storage().query(
            sql`SELECT t1.cells
                FROM files_frame_side_cells t1
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                LIMIT 1`
        );

        const rel = result[0];

        if (!rel) {
            return null;
        }

        return rel.cells;
    },

    getWorkerBeeCount: async function (frameSideId, uid) {
        const result = await storage().query(
            sql`SELECT t1.worker_bee_count
                FROM files_frame_side_rel t1
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                LIMIT 1`
        );

        const rel = result[0];

        if (!rel) {
            return null;
        }

        return rel.worker_bee_count;
    },

    getVarroaCount: async function (frameSideId, uid) {
        const result = await storage().query(
            sql`SELECT t1.varroa_count
                FROM files_frame_side_rel t1
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                LIMIT 1`
        );

        const rel = result[0];

        if (!rel) {
            return null;
        }

        return rel.varroa_count;
    },

    getDroneCount: async function (frameSideId, uid) {
        const result = await storage().query(
            sql`SELECT t1.drone_count
                FROM files_frame_side_rel t1
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                LIMIT 1`
        );

        const rel = result[0];

        if (!rel) {
            return null;
        }

        return rel.drone_count;
    },

    getQueenCount: async function (frameSideId, uid) {
        const result = await storage().query(
            sql`SELECT t1.queen_count
                FROM files_frame_side_rel t1
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                LIMIT 1`
        );

        const rel = result[0];

        if (!rel) {
            return null;
        }

        return rel.queen_count;
    },

    isQueenDetected: async function (frameSideId, uid) {
        const result = await storage().query(
            sql`SELECT t1.queen_detected
                FROM files_frame_side_rel t1
                WHERE t1.frame_side_id = ${frameSideId}
                  AND t1.user_id = ${uid}
                LIMIT 1`
        );

        const rel = result[0];

        if (!rel) {
            return true;
        }

        return rel.queen_detected ? true : false;
    },

    countDetectedVarroa: function (detectedVarroa: DetectedObject[]): number {
        let cnt = 0
        for (let o of detectedVarroa) {
            if (o.c > MIN_VARROA_CONFIDENCE) {
                cnt++
            }
        }

        return cnt;
    },

    countDetectedWorkerBees: function (detectedBees: DetectedObject[]): number {
        let cnt = 0
        for (let o of detectedBees) {
            if (o.c > 0.5 && (o.n == typeMap.BEE_WORKER || o.n == typeMap.BEE_WORKER_ALTERNATE)) {
                cnt++
            }
        }

        return cnt;
    },

    countDetectedDrones: function (detectedBees: DetectedObject[]): number {
        let cnt = 0
        for (let o of detectedBees) {
            if (o.c > 0.5 && o.n == typeMap.BEE_DRONE) {
                cnt++
            }
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

    updateFrameSideQueenPresense: async function (frameSideId, isPresent, uid) {
        await storage().query(
            sql`UPDATE files_frame_side_rel
                SET queen_detected=${isPresent}
                WHERE frame_side_id = ${frameSideId}
                  AND user_id = ${uid}`
        );
        return true;
    },

    updateQueens: async function (queens, frameSideId, uid) {
        const exQueensRes = await storage().query(
            sql`SELECT detected_queens
                FROM files_frame_side_rel
                WHERE frame_side_id = ${frameSideId}
                  AND user_id = ${uid}
                ORDER BY added_time DESC
                LIMIT 1`
        );

        let exQueens: DetectedObject[] = []
        if (exQueensRes && exQueensRes[0] && exQueensRes[0].detected_queens) {
            exQueens = exQueensRes[0].detected_queens
        }
        exQueens.push(...queens)

        await storage().query(
            sql`UPDATE files_frame_side_rel
                SET detected_queens=${JSON.stringify(exQueens)},
                    queen_count    = IFNULL(queen_count, 0) + ${exQueens.length},
                    queen_detected = ${exQueens.length > 0}
                WHERE frame_side_id = ${frameSideId}
                  AND user_id = ${uid}`
        );
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
            h2 = Number(h2) / (cutPosition.maxCutsX)
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