import { sql } from "@databases/mysql";

import {logger} from '../logger';
import { storage } from "./storage";
import fileModel from './file';

export default {
	getByFrameSideId: async function (frameSideId, uid) {
		const result = await storage().query(
			sql`SELECT t1.user_id, t2.filename, t1.strokeHistory, t1.detectedObjects, t2.width, t2.height, t2.id as fileId
			FROM files_frame_side_rel t1
			LEFT JOIN files t2 ON t1.file_id = t2.id
			WHERE t1.frame_side_id = ${frameSideId} AND t1.user_id = ${uid}
			LIMIT 1`
		);

		const rel = result[0];

		if (!rel) {
			return null;
		}

		return {
			__typename: 'FrameSideFile',
			frameSideId,
			strokeHistory: rel.strokeHistory,
			file: await fileModel.getById(rel.fileId, uid),
			detectedObjects: rel.detectedObjects
		};
	},
};
