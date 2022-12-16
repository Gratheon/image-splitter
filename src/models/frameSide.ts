import { sql } from "@databases/mysql";

import {logger} from '../logger';
import { storage } from "./storage";
import fileModel from './file';

function mergeDarknetResults(input, imageWidth, imageHeight) {
	const objects = [];

	for (let k in input) {
		let section9 = input[k]
		let x = parseInt(k[0], 10);
		let y = parseInt(k[1], 10);
		for (let o of section9[0].objects) {
			//@ts-ignore
			objects.push({
				n: o.name,
				c: o.confidence,
				p: [
					(o.relative_coordinates.center_x - o.relative_coordinates.width / 2) / 3 + x / 3, //x
					(o.relative_coordinates.center_y - o.relative_coordinates.height / 2) / 3 + y / 3, //y
					(o.relative_coordinates.width) / 3, //height
					(o.relative_coordinates.height)/ 3 //width
				],
			})
		}
	}

	logger.info('objects', objects);
	return objects
}

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
			detectedObjects: mergeDarknetResults(
				rel.detectedObjects,
				rel.width,
				rel.height
			)
		};
	},
};
