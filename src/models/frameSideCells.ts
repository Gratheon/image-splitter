import { sql } from "@databases/mysql";

import { storage } from "./storage";
import { logger } from "../logger";
import fileModel from './file';
import config from "../config";

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

export type FirstUnprocessedFile = {
	id: number,
	user_id: number,
	file_id: number,
	frame_side_id: number,
	filename: string,
	width: number,
	height: number,
	hash: string,
	url_version: number,
	ext: string,
	hive_id: number,
	url: string,
	localFilePath: string
}

const cellModel = {
	getCellsByFileId: async function (file_id:number) : Promise<FirstUnprocessedFile | null>{
		const result = await storage().query(
			sql`SELECT t1.user_id, t1.file_id, t1.frame_side_id, 
					t2.filename, t2.width, t2.height, t2.hash, t2.url_version, t2.ext,
					t3.hive_id
				FROM files_frame_side_cells t1
				LEFT JOIN files t2 ON t1.file_id = t2.id
				LEFT JOIN files_hive_rel t3 ON t1.file_id = t3.file_id
				WHERE t1.file_id = ${file_id} AND t1.inspection_id IS NULL
				ORDER BY t1.added_time ASC
				LIMIT 1`
		);

		const file = result[0];

		if (!file) {
			return null;
		}

		file.url = fileModel.getUrl(file);
		file.localFilePath = `${config.rootPath}tmp/${file.user_id}_cells_${file.filename}`;

		return file;
	},

	updateDetectedCells: async function (detections, fileId, frameSideId) {
		let cellCounts = cellModel.countCellsAbsoluteNrs(detections)
		let relativeCounts = cellModel.getRelativeCounts(cellCounts)

		logger.info("saving cells - counts to DB", { cellCounts, relativeCounts, fileId, frameSideId });

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

			WHERE file_id=${fileId} AND 
				frame_side_id=${frameSideId} AND 
				inspection_id IS NULL`
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

	addFrameCells: async function (file_id, frame_side_id, user_id) {
		// @ts-ignore
		return (await storage().query(sql`
		  INSERT INTO files_frame_side_cells (file_id, frame_side_id, user_id) 
		  VALUES (${file_id}, ${frame_side_id}, ${user_id});
		  SELECT LAST_INSERT_ID() as id;
		  `))[0].id;
	},

	getByFrameSideId: async function (frameSideId, uid, fieldsRequested: string[]) {
		let extraFields = sql``

		// cells are very heavy so we only load them if requested
		if (fieldsRequested.indexOf('cells') === -1) {
			extraFields = sql`, t3.cells`
		}

		const result = await storage().query(
			sql`SELECT t1.user_id, t1.queen_detected,
			t3.brood, t3.capped_brood, t3.eggs, t3.pollen, t3.honey
			${extraFields}
			FROM files_frame_side_rel t1
			LEFT JOIN files_frame_side_cells t3 
				ON t1.file_id = t3.file_id
			WHERE
				t1.user_id = ${uid} AND 
				t1.frame_side_id = ${frameSideId} AND 
				t1.inspection_id IS NULL
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
			cells: rel?.cells,

			// percentage
			broodPercent: rel.brood,
			cappedBroodPercent: rel.capped_brood,
			eggsPercent: rel.eggs,
			pollenPercent: rel.pollen,
			honeyPercent: rel.honey
		};
	},

	getByFrameSideAndInspectionId: async function (frameSideId, inspectionId, uid) {
		//t1.detected_bees
		const result = await storage().query(
			sql`SELECT t1.user_id, t1.queen_detected,
				t3.cells, t3.brood, t3.capped_brood, t3.eggs, t3.pollen, t3.honey
			FROM files_frame_side_rel t1
			LEFT JOIN files_frame_side_cells t3 
				ON t1.file_id = t3.file_id
			WHERE 
				t1.frame_side_id = ${frameSideId} AND 
				t1.user_id = ${uid} AND 
				t1.inspection_id = ${inspectionId}
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
			cells: rel.cells,

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
			WHERE 
				user_id=${uid} AND 
				frame_side_id=${frameSideId} AND 
				inspection_id IS NULL`
		);
	},

	cloneFramesForInspection: async function (frameSideIDs: number[], inspectionId: number, uid: number) {
		await storage().query(
			sql`UPDATE files_frame_side_cells
			SET inspection_id=${inspectionId}
			WHERE 
				inspection_id IS NULL AND 
				frame_side_id IN (${frameSideIDs}) AND 
				user_id=${uid}`
		);

		return true
	}

};

export default cellModel;