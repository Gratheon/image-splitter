import { sql } from "@databases/mysql";

import { logger } from '../logger';
import { storage } from "./storage";
import fileModel from './file';


let typeMap = {
	'BEE_WORKER': '0',
	'BEE_DRONE': '1',
	'BEE_WORKER_ALTERNATE': '2',
	'BEE_QUEEN': '3'
}



// Beehive frames have sides
// For every side we detect bees
// We also allow drawing with ipad pencil on it - strokeHistory
// 
const frameSideModel = {
	startDetection: async function (fileId, frameSideId) {
		logger.info(`updating DB to start bee detection for fileid ${fileId}`);
		await storage().query(
			sql`UPDATE files_frame_side_rel SET process_start_time=NOW() WHERE file_id=${fileId} AND frame_side_id=${frameSideId}`
		);
	},
	getFirstUnprocessedBees: async function () {
		const result = await storage().query(
			sql`SELECT t1.user_id, t2.filename, t2.width, t2.height, t1.file_id, t1.frame_side_id, t2.hash, t2.url_version, t2.ext
			FROM files_frame_side_rel t1
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
		file.localFilePath = `tmp/${file.user_id}_bees_${file.filename}`;

		return file;
	},

	endDetection: async function (fileId, frameSideId) {
		logger.info(`bee detections complete for ${fileId}`);
		await storage().query(
			sql`UPDATE files_frame_side_rel SET process_end_time=NOW() WHERE file_id=${fileId} AND frame_side_id=${frameSideId}`
		);
	},

	getAvgProcessingTime: async function () {
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

	countPendingJobs: async function () {
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
		//t1.detected_bees
		const result = await storage().query(
			sql`SELECT t1.user_id, t2.filename, t1.strokeHistory, t3.cells, t4.cups,
			t2.width, t2.height, t2.id as fileId
			FROM files_frame_side_rel t1
			LEFT JOIN files t2 ON t1.file_id = t2.id
			LEFT JOIN files_frame_side_cells t3 ON t1.file_id = t3.file_id
			LEFT JOIN files_frame_side_queen_cups t4 ON t1.file_id = t4.file_id
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
			// detectedBees: rel.detected_bees,
			detectedFrameResources: rel.cells,
			detectedQueenCups: rel.detected_queen_cups
		};
	},


	updateDetectedBees: async function (detections, fileId, frameSideId) {
		const workerBeeCount = frameSideModel.countDetectedWorkerBees(detections)
		const detectedDrones = frameSideModel.countDetectedDrones(detections)
		const countDetectedQueens = frameSideModel.countDetectedQueens(detections)

		logger.info(`Updating detected bees in DB, setting counts ${workerBeeCount} / ${detectedDrones} / ${countDetectedQueens}`)
		await storage().query(
			sql`UPDATE files_frame_side_rel 
				SET detected_bees=${JSON.stringify(detections)},
				worker_bee_count = IFNULL(worker_bee_count,0) + ${workerBeeCount},
				drone_count = IFNULL(drone_count,0) + ${detectedDrones},
				queen_count = IFNULL(queen_count,0) + ${countDetectedQueens}
				WHERE file_id=${fileId} AND frame_side_id=${frameSideId}`
		);
		return true;
	},

	getDetectedBees: async function (frameSideId, uid) {
		const result = await storage().query(
			sql`SELECT t1.detected_bees
			FROM files_frame_side_rel t1
			WHERE t1.frame_side_id = ${frameSideId} AND t1.user_id = ${uid}
			LIMIT 1`
		);

		const rel = result[0];

		if (!rel) {
			return null;
		}

		return rel.detected_bees;
	},
	getWorkerBeeCount: async function (frameSideId, uid) {
		const result = await storage().query(
			sql`SELECT t1.worker_bee_count
			FROM files_frame_side_rel t1
			WHERE t1.frame_side_id = ${frameSideId} AND t1.user_id = ${uid}
			LIMIT 1`
		);

		const rel = result[0];

		if (!rel) {
			return null;
		}

		return rel.worker_bee_count;
	},
	getDroneCount: async function (frameSideId, uid) {
		const result = await storage().query(
			sql`SELECT t1.drone_count
			FROM files_frame_side_rel t1
			WHERE t1.frame_side_id = ${frameSideId} AND t1.user_id = ${uid}
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
			WHERE t1.frame_side_id = ${frameSideId} AND t1.user_id = ${uid}
			LIMIT 1`
		);

		const rel = result[0];

		if (!rel) {
			return null;
		}

		return rel.queen_count;
	},

	isComplete: async function (frameSideId, uid) {
		const result = await storage().query(
			sql`SELECT t1.process_end_time
			FROM files_frame_side_rel t1
			WHERE t1.frame_side_id = ${frameSideId} AND t1.user_id = ${uid}
			LIMIT 1`
		);

		const rel = result[0];

		if (!rel) {
			return true;
		}

		return rel.process_end_time ? true : false;
	},

	countDetectedWorkerBees: function (detectedBees): number {
		let cnt = 0
		for (let o of detectedBees) {
			if (o.n == typeMap.BEE_WORKER || o.n == typeMap.BEE_WORKER_ALTERNATE) {
				cnt++
			}
		}

		return cnt;
	},
	countDetectedDrones: function (detectedBees): number {
		let cnt = 0
		for (let o of detectedBees) {
			if (o.n == typeMap.BEE_DRONE) {
				cnt++
			}
		}

		return cnt;
	},
	countDetectedQueens: function (detectedBees): number {
		let cnt = 0
		for (let o of detectedBees) {
			if (o.n == typeMap.BEE_QUEEN) {
				cnt++
			}
		}

		return cnt;
	},
};

export default frameSideModel