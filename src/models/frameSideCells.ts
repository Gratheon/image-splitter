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
			sql`UPDATE files_frame_side_cells SET process_start_time=NOW() WHERE file_id=${fileId} AND frame_side_id=${frameSideId}`
		);
	},

	getFirstUnprocessedCells: async function () {
		const result = await storage().query(
			sql`SELECT t1.user_id, t2.filename, t2.width, t2.height, t1.file_id, t1.frame_side_id, t2.hash, t2.url_version, t2.ext
				FROM files_frame_side_cells t1
				LEFT JOIN files t2 ON t1.file_id = t2.id
				WHERE t1.process_start_time IS NULL
				ORDER BY t1.added_time ASC
				LIMIT 1`
		);

		const file = result[0];

		if (!file) {
			return null;
		}

		file.url = fileModel.getUrl(file);
		file.localFilePath = `tmp/${file.user_id}_cells_${file.filename}`;

		return file;
	},

	updateDetectedResources: async function (detections, fileId, frameSideId) {
		logger.info("saving frame resource response to DB");

		await storage().query(
			sql`UPDATE files_frame_side_cells 
			SET cells=${JSON.stringify(detections)}
			WHERE file_id=${fileId} AND frame_side_id=${frameSideId}`
		);
		return true;
	},


	endDetection: async function (fileId, frameSideId) {
		logger.info(`ending bee detection for fileid ${fileId}`);
		await storage().query(
			sql`UPDATE files_frame_side_cells SET process_end_time=NOW() WHERE file_id=${fileId} AND frame_side_id=${frameSideId}`
		);
	},
};