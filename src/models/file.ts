import { sql } from "@databases/mysql";

import { storage } from "./storage";
import config from "../config/index";

const fileModel = {
  getUrl(file) {
    if (file.url_version == 1) {
      return `${config.files_base_url}${file.user_id}/${file.filename}`
    } else {
      return `${config.files_base_url}${file.user_id}/${file.hash}/original${file.ext ? "." + file.ext : ''}`
    }
  },

  updateDimentions: async function ({ width, height }, fileId: number) {
    await storage().query(
      sql`UPDATE files SET width=${width}, height=${height} WHERE id=${fileId}`
    );
  },

  getByFrameSideId: async function (id, uid) {
    const result = await storage().query(
      sql`SELECT t1.user_id, t2.filename, t1.strokeHistory, t1.detected_bees, t3.cells, t2.width, t2.height, t2.url_version, t2.ext
			FROM files_frame_side_rel t1
			LEFT JOIN files t2 ON t1.file_id = t2.id
      LEFT JOIN files_frame_side_resources t3 ON t1.file_id=t3.file_id
			WHERE t1.frame_side_id = ${id} and t1.user_id = ${uid}
        AND t1.inspection_id IS NULL
			LIMIT 1`
    );

    const file = result[0];

    if (!file) {
      return null;
    }

    return {
      __typename: "File",
      id,
      url: fileModel.getUrl(file),
    };
  },

  getByFrameSideAndInspectionId: async function (id, inspectionId, uid) {
    const result = await storage().query(
      sql`SELECT t1.user_id, t2.filename, t1.strokeHistory, t1.detected_bees, t3.cells, t2.width, t2.height, t2.url_version, t2.ext
			FROM files_frame_side_rel t1
			LEFT JOIN files t2 ON t1.file_id = t2.id
      LEFT JOIN files_frame_side_resources t3 ON t1.file_id=t3.file_id
			WHERE t1.frame_side_id = ${id} and t1.user_id = ${uid}
        AND t1.inspection_id = ${inspectionId}
			LIMIT 1`
    );

    const file = result[0];

    if (!file) {
      return null;
    }

    return {
      __typename: "File",
      id,
      url: fileModel.getUrl(file),
    };
  },

  countAllBees: async function (hiveId, uid) {
    const result = await storage().query(
      sql`SELECT SUM(t2.worker_bee_count) + SUM(t2.drone_count) + SUM(t2.queen_count) as cnt
				FROM files_hive_rel t1
				INNER JOIN files_frame_side_rel t2 ON t2.file_id = t1.file_id
				WHERE t1.user_id = ${uid} AND t1.hive_id=${hiveId}
				LIMIT 1`
    );

    return result[0].cnt;
  },

  getByHiveId: async function (hiveId, uid) {
    const files = await storage().query(
      sql`SELECT t2.id, t2.user_id, t2.filename, t2.url_version, t2.hash, t2.ext,
        t3.frame_side_id, t3.strokeHistory
      FROM files t2
      INNER JOIN files_frame_side_rel t3 ON t3.file_id = t2.id AND t3.inspection_id IS NULL
      WHERE t2.id IN (
        SELECT t1.file_id FROM files_hive_rel t1 WHERE t1.hive_id = ${hiveId}
      ) AND t2.user_id = ${uid}
      LIMIT 500`
    );

    const r = [];

    if (!files) {
      return r;
    }

    for (let file of files) {
      // @ts-ignore
      r.push({
        hiveId,
        frameSideId: file.frame_side_id,
        strokeHistory: file.strokeHistory,
        file: {
          __typename: "File",
          ...file,
          url: fileModel.getUrl(file),
        },
      });
    }

    return r;
  },

  getById: async function (id, uid) {
    const result = await storage().query(
      sql`SELECT id, user_id, filename, hash, url_version, ext
			FROM files
			WHERE id=${id} and user_id=${uid}
			LIMIT 1`
    );

    const file = result[0];
    return {
      __typename: "File",
      id,
      url: fileModel.getUrl(file),
    };
  },

  getFileExtension: function (filename) {
    if (filename) {
      const parts = filename.split(".");
      if (parts.length > 1) {
        // Take the text after the last dot as the extension
        const lastPart = parts.pop();
        return lastPart.toLowerCase();
      }
    }
    return ""; // Return an empty string for invalid or extension-less filenames.
  },

  insert: async function (user_id, filename, ext, hash, width, height) {
    // @ts-ignore
    return (await storage().query(sql`
    INSERT INTO files (user_id, filename, hash, ext, width, height, url_version) 
    VALUES (${user_id}, ${filename}, ${hash}, ${ext}, ${width}, ${height}, 2);
    SELECT LAST_INSERT_ID() as id;
    `))[0].id;
  },

  addHiveRelation: async function (file_id, hive_id, user_id) {
    // @ts-ignore
    return (await storage().query(sql`
    INSERT INTO files_hive_rel (file_id, hive_id, user_id) 
    VALUES (${file_id}, ${hive_id}, ${user_id});
    SELECT LAST_INSERT_ID() as id;
    `))[0].id;
  },

  addFrameRelation: async function (file_id, frame_side_id, user_id) {
    // @ts-ignore
    return (await storage().query(sql`
      INSERT INTO files_frame_side_rel (file_id, frame_side_id, user_id) 
      VALUES (${file_id}, ${frame_side_id}, ${user_id});
      SELECT LAST_INSERT_ID() as id;
      `))[0].id;
  }
};

export default fileModel;