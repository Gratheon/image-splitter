import { sql } from "@databases/mysql";

import { storage } from "./storage";
import config from "../config/index";

export default {
	insertResize: async function (file_id, max_dimension_px) {
		// @ts-ignore
		return (await storage().query(sql`
			INSERT INTO files_resized (file_id, max_dimension_px) 
			VALUES (${file_id}, ${max_dimension_px});
			SELECT LAST_INSERT_ID() as id;
		`))[0].id;
	},

	getResizes: async function (file_id, uid) {
		const rows = await storage().query(
			sql`SELECT files_resized.id, files_resized.max_dimension_px, files.hash, files.user_id, files.ext
				FROM files_resized 
				INNER JOIN files ON files.id = files_resized.file_id
				WHERE file_id=${file_id} and user_id=${uid}`
		);

		const result = []
		for (const row of rows) {
			// @ts-ignore
			result.push({
				__typename: "FileResize",
				id: row.id,
				file_id: file_id,
				max_dimension_px: row.max_dimension_px,
				url: `${config.files_base_url}${row.user_id}/${row.hash}/${row.max_dimension_px}${row.ext ? "." + row.ext : ''}`,
			});
		}
		return result;
	},
}