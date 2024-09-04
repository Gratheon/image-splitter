import { sql } from "@databases/mysql";

import { storage } from "./storage";
import { logger } from "../logger";
import fileModel from './file';

// Beehive frame has sides
// For every side, we try to detect types of cells
// Then we store it in DB

export default {
	getFirstUnprocessedCups: async function () {
		const result = await storage().query(
			sql`SELECT t1.user_id, 
       				t2.filename, t2.width, t2.height, t1.file_id, t1.frame_side_id, t2.hash, t2.url_version, t2.ext
				FROM files_frame_side_queen_cups t1
				INNER JOIN jobs t4 ON t4.ref_id = t1.id AND t4.type='cups'
				LEFT JOIN files t2 ON t1.file_id = t2.id
				WHERE t4.process_start_time IS NULL
				ORDER BY t1.added_time ASC
				LIMIT 1`
		);

		const file = result[0];

		if (!file) {
			return null;
		}

		file.url = fileModel.getUrl(file);
		file.localFilePath = `tmp/${file.user_id}_cups_${file.filename}`;

		return file;
	},

	updateDetectedQueenCups: async function (detections, fileId, frameSideId) {
		await storage().query(
			sql`UPDATE files_frame_side_queen_cups 
				SET cups=${JSON.stringify(detections)}
				WHERE file_id=${fileId} AND frame_side_id=${frameSideId}`
		);
		return true;
	},

	addFrameCups: async function (file_id, frame_side_id, user_id) {
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
			WHERE inspection_id IS NULL AND frame_side_id IN (${frameSideIDs}) AND user_id=${uid}`
		);

		return true
	}
};