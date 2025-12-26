const DataLoader = require('dataloader');
import { sql } from "@databases/mysql";
import { storage } from "../models/storage";
import { logger } from "../logger";

export interface FrameSideCellsData {
    __typename: string;
    id: string;
    frameSideId: string;
    cells: any;
    broodPercent: number | null;
    cappedBroodPercent: number | null;
    eggsPercent: number | null;
    pollenPercent: number | null;
    honeyPercent: number | null;
}

export interface LoaderContext {
    uid: number;
    frameSideCellsLoader: any;
}

function createFrameSideCellsLoader(uid: number): any {
    return new DataLoader(
        async (frameSideIds: readonly string[]) => {
            if (frameSideIds.length === 0) {
                return [];
            }

            const frameSideIdNumbers = frameSideIds.map(id => parseInt(id, 10));

            try {
                const results = await storage().query(
                    sql`SELECT 
                        t1.frame_side_id,
                        t1.user_id, 
                        t1.queen_detected,
                        t3.brood, 
                        t3.capped_brood, 
                        t3.eggs, 
                        t3.pollen, 
                        t3.honey
                    FROM files_frame_side_rel t1
                    LEFT JOIN files_frame_side_cells t3 
                        ON t1.file_id = t3.file_id
                    WHERE
                        t1.user_id = ${uid} AND 
                        t1.frame_side_id IN (${frameSideIdNumbers}) AND 
                        t1.inspection_id IS NULL`
                );

                const cellsMap = new Map<string, FrameSideCellsData>();

                for (const rel of results) {
                    if (rel && rel['frame_side_id']) {
                        const frameSideIdStr = String(rel['frame_side_id']);
                        cellsMap.set(frameSideIdStr, {
                            __typename: 'FrameSideCells',
                            id: frameSideIdStr,
                            frameSideId: frameSideIdStr,
                            cells: rel['cells'] || null,
                            broodPercent: rel['brood'],
                            cappedBroodPercent: rel['capped_brood'],
                            eggsPercent: rel['eggs'],
                            pollenPercent: rel['pollen'],
                            honeyPercent: rel['honey']
                        });
                    }
                }

                return frameSideIds.map(id => cellsMap.get(id) || null);
            } catch (error) {
                logger.error('Error in frameSideCellsLoader', { error, frameSideIds, uid });
                return frameSideIds.map(() => null);
            }
        },
        {
            cache: true,
            maxBatchSize: 100
        }
    );
}

export function createLoaders(uid: number): LoaderContext {
    return {
        uid,
        frameSideCellsLoader: createFrameSideCellsLoader(uid)
    };
}

