import { sql } from "@databases/mysql";

import { storage } from "./storage";
import { logger } from "../logger";
import fileModel from './file';

// Beehive frame has sides
// For every side, we try to detect types of cells
// Then we store it in DB

export default {
	startDetection: async function (fileId, frameSideId) {
		logger.info(`starting bee detection for fileid ${fileId}`);
		await storage().query(
			sql`UPDATE files_frame_side_queen_cups SET process_start_time=NOW() WHERE file_id=${fileId} AND frame_side_id=${frameSideId}`
		);
	},

	updateDetectedQueenCups: async function (detections, fileId, frameSideId) {
		await storage().query(
		  sql`UPDATE files_frame_side_queen_cups 
				SET detected_queen_cups=${JSON.stringify(detections)}
				WHERE file_id=${fileId} AND frame_side_id=${frameSideId}`
		);
		return true;
	  },

	  endDetection: async function (fileId, frameSideId) {
		logger.info(`ending bee detection for fileid ${fileId}`);
		await storage().query(
			sql`UPDATE files_frame_side_queen_cups SET process_end_time=NOW() WHERE file_id=${fileId} AND frame_side_id=${frameSideId}`
		);
	},
};