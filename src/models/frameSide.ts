import { sql } from "@databases/mysql";

import { log, logger } from '../logger';
import { storage } from "./storage";
import fileModel from './file';


let typeMap = {
	'BEE_WORKER': '0',
	'BEE_DRONE': '1',
	'BEE_WORKER_ALTERNATE': '2',
	'BEE_QUEEN': '3'
}


export type CutPosition = {
	width: number
	height: number
	left: number
	top: number
}

export type DetectedObject = {
	n: String, // class. 10 - queen cup. 11 - varroa
	x: number
	y: number
	w: number
	h: number
	c: number // confidence
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

	getLastestByFrameSideId: async function (frameSideId, uid) {
		//t1.detected_bees
		const result = await storage().query(
			sql`SELECT t1.user_id, t1.strokeHistory, t1.queen_detected,
				t2.filename, t2.width, t2.height, t2.id as fileId,
				t4.cups
			FROM files_frame_side_rel t1
				LEFT JOIN files t2 ON t1.file_id = t2.id
				LEFT JOIN files_frame_side_queen_cups t4 ON t1.file_id = t4.file_id
			WHERE t1.frame_side_id = ${frameSideId} AND t1.user_id = ${uid}
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

		let exDetectedBees = await frameSideModel.getDetectedBees(frameSideId, fileId, uid)
		log({ exDetectedBees })
		// let exDetectedBees: DetectedObject[] = []
		// if (strExBees) {
		// 	exDetectedBees = JSON.parse(strExBees)
		// }

		exDetectedBees.push(...detectedBees)

		logger.info(`Updating detected bees in DB, setting counts ${workerBeeCount} / ${detectedDrones}`)
		const db = storage()
		await db.query(
			sql`UPDATE files_frame_side_rel 
				SET 
					detected_bees=${JSON.stringify(exDetectedBees)},
					worker_bee_count = IFNULL(worker_bee_count,0) + ${workerBeeCount},
					drone_count = IFNULL(drone_count,0) + ${detectedDrones}
					WHERE file_id=${fileId} AND frame_side_id=${frameSideId} AND user_id = ${uid}`
		);
		return true;
	},
	updateDetectedVarroa: async function (detectedVarroa, fileId, frameSideId, uid) {
		const countDetectedVarroa = frameSideModel.countDetectedVarroa(detectedVarroa)
		let exDetectedVarroa = await frameSideModel.getDetectedVarroa(frameSideId, uid)
		if (!exDetectedVarroa) {
			exDetectedVarroa = []
		}
		exDetectedVarroa.push(...detectedVarroa)

		logger.info(`Updating detected varroa in DB, setting counts ${countDetectedVarroa}`)
		await storage().query(
			sql`UPDATE files_frame_side_rel 
				SET 
					detected_varroa=${JSON.stringify(exDetectedVarroa)},
					varroa_count = IFNULL(varroa_count,0) + ${countDetectedVarroa}
					WHERE file_id=${fileId} AND frame_side_id=${frameSideId} AND user_id = ${uid}`
		);
		return true;
	},

	getDetectedBees: async function (frameSideId, fileId, uid): Promise<DetectedObject[]> {
		const result = await storage().query(
			sql`SELECT detected_bees
			FROM files_frame_side_rel
			WHERE file_id=${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid}
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
			WHERE frame_side_id = ${frameSideId} AND user_id = ${uid}
			ORDER BY added_time DESC
			LIMIT 1`
		);

		const rel = result[0];

		if (!rel) {
			return [];
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
			WHERE t1.frame_side_id = ${frameSideId} AND t1.user_id = ${uid}
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
			WHERE t1.frame_side_id = ${frameSideId} AND t1.user_id = ${uid}
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
			WHERE t1.frame_side_id = ${frameSideId} AND t1.user_id = ${uid}
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
			WHERE t1.frame_side_id = ${frameSideId} AND t1.user_id = ${uid}
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

	isQueenDetected: async function (frameSideId, uid) {
		const result = await storage().query(
			sql`SELECT t1.queen_detected
			FROM files_frame_side_rel t1
			WHERE t1.frame_side_id = ${frameSideId} AND t1.user_id = ${uid}
			LIMIT 1`
		);

		const rel = result[0];

		if (!rel) {
			return true;
		}

		return rel.queen_detected ? true : false;
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

	countDetectedVarroa: function (detectedVarroa: DetectedObject[]): number {
		let cnt = 0
		for (let o of detectedVarroa) {
			if (o.c > 0.6) {
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
			WHERE file_id=${file.fileId} AND frame_side_id=${file.frameSideId} AND user_id=${uid}`
			);
		}

		return true;
	},
	updateFrameSideQueenPresense: async function (frameSideId, isPresent, uid) {
		await storage().query(
			sql`UPDATE files_frame_side_rel
			SET queen_detected=${isPresent}
			WHERE frame_side_id=${frameSideId} AND user_id=${uid}`
		);
		return true;
	},
	updateQueens: async function (queens, frameSideId, uid) {
		const exQueensRes = await storage().query(
			sql`SELECT detected_queens
			FROM files_frame_side_rel
			WHERE frame_side_id = ${frameSideId} AND user_id = ${uid}
			ORDER BY added_time DESC
			LIMIT 1`
		);

		log({exQueensRes})

		let exQueens: DetectedObject[] = []
		if (exQueensRes && exQueensRes[0] && exQueensRes[0].detected_queens) {
			exQueens = exQueensRes[0].detected_queens
		}
		exQueens.push(...queens)

		await storage().query(
			sql`UPDATE files_frame_side_rel
			SET detected_queens=${JSON.stringify(exQueens)}, 
				queen_count = IFNULL(queen_count,0) + ${exQueens.length},
				queen_detected = ${exQueens.length > 0}
			WHERE frame_side_id=${frameSideId} AND user_id=${uid}`
		);
		return true;
	},

	cloneFramesForInspection: async function (frameSideIDs: number[], inspectionId: number, uid: number) {
		await storage().query(
			sql`UPDATE files_frame_side_rel
			SET inspection_id=${inspectionId}
			WHERE inspection_id IS NULL AND frame_side_id IN (${frameSideIDs}) AND user_id=${uid}`
		);

		return true
	}
};

export default frameSideModel


export function convertDetectedBeesStorageFormat(txt: string, cutPosition: CutPosition, splitCountX, splitCountY): DetectedObject[] {
	logger.info('Converting JSON to more compact format');
	const result: DetectedObject[] = [];
	const lines = txt.split("\n");

	for (let line of lines) {
		if (line.length < 5) continue;

		const [n, x, y, w, h, c] = line.split(' ');

		// skip queen detections coming from models-bee-detector
		// we run a separate model for queen detection in clarifai
		if (n !== typeMap.BEE_QUEEN) {
			result.push({
				n,
				x: roundToDecimal((Number(x) * cutPosition.width + cutPosition.left) / (splitCountX * cutPosition.width), 5),
				y: roundToDecimal((Number(y) * cutPosition.height + cutPosition.top) / (splitCountY * cutPosition.height), 5),
				w: roundToDecimal(Number(w) / (splitCountX), 4),
				h: roundToDecimal(Number(h) / (splitCountY), 4),
				c: roundToDecimal(Number(c), 2)
			});
		}
	}

	return result;
}

function roundToDecimal(num: number, decimalPlaces: number): number {
	const multiplier = Math.pow(10, decimalPlaces);
	return Math.round(num * multiplier) / multiplier;
}
