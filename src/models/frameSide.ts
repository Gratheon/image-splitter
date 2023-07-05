import { sql } from "@databases/mysql";

import {logger} from '../logger';
import { storage } from "./storage";
import fileModel from './file';

export default {
	getAvgProcessingTime: async function(){
		const result = await storage().query(
		sql`SELECT AVG(process_end_time-process_start_time) as time FROM (
			SELECT * FROM files_frame_side_rel WHERE process_start_time IS NOT NULL ORDER BY frame_side_id DESC LIMIT 10
			) t2`
		);

		const rel = result[0];

		if (!rel) {
			return 0;
		}

		return rel.time
	},

	countPendingJobs: async function(){
		const result = await storage().query(
			sql`SELECT COUNT(*) cnt FROM files_frame_side_rel WHERE process_start_time IS NULL`
		);

		const rel = result[0];

		if (!rel) {
			return 0; //lets say it takes 1 sec on avg
		}

		return rel.cnt;
	},

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

	countDetectedObjects: async function(detectedObjects): Promise<DetectedObjectCount[]> {
		let result: DetectedObjectCount[] = [];
		let map = new Map();
		let typeMap = {
			'0': 'BEE_WORKER',
			'1': 'BEE_DRONE',
			'2': 'BEE_WORKER',
			'3': 'BEE_QUEEN'
		}

		for(let o of detectedObjects){
			const exValue = map.get(o.n);
			map.set(
				o.n,
				exValue ? exValue + 1 : 1
			)
		}

		for(let r of map){
			result.push({
				type: typeMap[r[0]], 
				count: r[1]
			});
		}

		return result;
	},
};

type DetectedObjectCount = {
	count: number
	type: string
}