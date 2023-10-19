import { sql } from "@databases/mysql";

import { storage } from "./storage";
import { logger } from "../logger";
import fileModel from './file';

// Beehive frame has sides
// For every side, we try to detect types of cells
// Then we store it in DB

export type CellCounts = {
	honey: number,
	brood: number,
	eggs: number,
	capped_brood: number,
	pollen: number,
	nectar: number,
	empty: number
}

const cellModel = {
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

	updateDetectedCells: async function (detections, fileId, frameSideId) {
		let cellCounts = cellModel.countCellsAbsoluteNrs(detections)
		let relativeCounts = cellModel.getRelativeCounts(cellCounts)

		logger.info("saving cells - absolute counts to DB");
		logger.info(cellCounts);

		logger.info("saving cells - relative counts to DB");
		logger.info(relativeCounts);

		await storage().query(
			sql`UPDATE files_frame_side_cells 
			SET 
				cells=${JSON.stringify(detections)},

				honey_cell_count=${cellCounts.honey},
				brood_cell_count=${cellCounts.brood},
				egg_cell_count=${cellCounts.eggs},
				capped_brood_cell_count=${cellCounts.capped_brood},
				pollen_cell_count=${cellCounts.pollen},
				nectar_cell_count=${cellCounts.nectar},
				empty_cell_count=${cellCounts.empty},

				brood=${relativeCounts.brood},
				capped_brood=${relativeCounts.capped_brood},
				eggs=${relativeCounts.eggs},
				pollen=${relativeCounts.pollen},
				honey=${relativeCounts.honey}

			WHERE file_id=${fileId} AND frame_side_id=${frameSideId}`
		);

		return relativeCounts;
	},

	countCellsAbsoluteNrs: function (detections): CellCounts {
		let honey = 0
		let brood = 0
		let eggs = 0
		let capped_brood = 0
		let pollen = 0
		let nectar = 0
		let empty = 0


		for (let o of detections) {
			switch (o[0]) {
				case 0: capped_brood++; break;
				case 1: eggs++; break;
				case 2: honey++; break;
				case 3: brood++; break;
				case 4: nectar++; break;
				case 5: empty++; break;
				case 6: pollen++; break;
			}
		}

		return {
			honey,
			brood,
			eggs,
			capped_brood,
			pollen,
			nectar,
			empty
		}
	},

	getRelativeCounts(c: CellCounts): CellCounts {
		let total = c.brood + c.honey + c.eggs + c.capped_brood + c.pollen + c.nectar + c.empty

		return {
			honey: Math.floor(100 * c.honey / total),
			brood: Math.floor(100 * c.brood / total),
			eggs: Math.floor(100 * c.eggs / total),
			capped_brood: Math.floor(100 * c.capped_brood / total),
			pollen: Math.floor(100 * c.pollen / total),
			nectar: Math.floor(100 * c.nectar / total),
			empty: Math.floor(100 * c.empty / total)
		}
	},

	endDetection: async function (fileId, frameSideId) {
		logger.info(`ending bee detection for fileid ${fileId}`);
		await storage().query(
			sql`UPDATE files_frame_side_cells SET process_end_time=NOW() WHERE file_id=${fileId} AND frame_side_id=${frameSideId}`
		);
	},

	isComplete: async function (frameSideId, uid) {
		const result = await storage().query(
			sql`SELECT process_end_time
			FROM files_frame_side_cells t1
			WHERE frame_side_id = ${frameSideId} AND user_id = ${uid}
			LIMIT 1`
		);

		const rel = result[0];

		if (!rel) {
			return true;
		}

		return rel.process_end_time ? true : false;
	},

	addFrameCells: async function (file_id, frame_side_id, user_id) {
		// @ts-ignore
		return (await storage().query(sql`
		  INSERT INTO files_frame_side_cells (file_id, frame_side_id, user_id) 
		  VALUES (${file_id}, ${frame_side_id}, ${user_id});
		  SELECT LAST_INSERT_ID() as id;
		  `))[0].id;
	},

	getByFrameSideId: async function (frameSideId, uid) {
		//t1.detected_bees
		const result = await storage().query(
			sql`SELECT t1.user_id, t1.queen_detected,
			t3.brood, t3.capped_brood, t3.eggs, t3.pollen, t3.honey

			FROM files_frame_side_rel t1
			LEFT JOIN files_frame_side_cells t3 ON t1.file_id = t3.file_id
			WHERE t1.frame_side_id = ${frameSideId} AND t1.user_id = ${uid}
			LIMIT 1`
		);

		const rel = result[0];

		if (!rel) {
			return null;
		}

		return {
			__typename: 'FrameSideCells',
			id: frameSideId,
			frameSideId,

			// percentage
			broodPercent: rel.brood,
			cappedBroodPercent: rel.capped_brood,
			eggsPercent: rel.eggs,
			pollenPercent: rel.pollen,
			honeyPercent: rel.honey
		};
	},


	updateRelativeCells: async function (cells, uid, frameSideId) {
		await storage().query(
			sql`UPDATE files_frame_side_cells 
			SET 
				brood=${cells.broodPercent},
				capped_brood=${cells.cappedBroodPercent},
				eggs=${cells.eggsPercent},
				pollen=${cells.pollenPercent},
				honey=${cells.honeyPercent}

			WHERE user_id=${uid} AND frame_side_id=${frameSideId}`
		);
	},

};

export default cellModel;