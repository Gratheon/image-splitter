import { sql } from "@databases/mysql";

import { storage } from "./storage";
import config from "../config/index";

const fileModel = {
  getFirstUnprocessedFile: async function () {
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
    file.localFilePath = `tmp/${file.user_id}_${file.filename}`;

    return file;
  },

  getUrl(file) {
    if (file.url_version == 1) {
      return `${config.files_base_url}${file.user_id}/${file.filename}`
    } else {
      return `${config.files_base_url}${file.user_id}/${file.hash}/original${file.ext ? "." + file.ext : ''}`
    }
  },

  updateDetectedBees: async function (detections, fileId, frameSideId) {
    await storage().query(
      sql`UPDATE files_frame_side_rel 
			SET detected_bees=${JSON.stringify(detections)}
			WHERE file_id=${fileId} AND frame_side_id=${frameSideId}`
    );
    return true;
  },
  updateDetectedResources: async function (detections, fileId, frameSideId) {
    await storage().query(
      sql`UPDATE files_frame_side_rel 
			SET detected_frame_resources=${JSON.stringify(detections)}
			WHERE file_id=${fileId} AND frame_side_id=${frameSideId}`
    );
    return true;
  },
  startDetection: async function (fileId, frameSideId) {
    await storage().query(
      sql`UPDATE files_frame_side_rel SET process_start_time=NOW() WHERE file_id=${fileId} AND frame_side_id=${frameSideId}`
    );
  },
  endDetection: async function (fileId, frameSideId) {
    await storage().query(
      sql`UPDATE files_frame_side_rel SET process_end_time=NOW() WHERE file_id=${fileId} AND frame_side_id=${frameSideId}`
    );
  },
  updateDimentions: async function ({ width, height }, fileId: number) {
    await storage().query(
      sql`UPDATE files SET width=${width}, height=${height} WHERE id=${fileId}`
    );
  },
  getByFrameSideId: async function (id, uid) {
    const result = await storage().query(
      sql`SELECT t1.user_id, t2.filename, t1.strokeHistory, t1.detected_bees, t1.detected_frame_resources, t2.width, t2.height, t2.url_version, t2.ext
			FROM files_frame_side_rel t1
			LEFT JOIN files t2 ON t1.file_id = t2.id
			WHERE t1.frame_side_id = ${id}
			and t1.user_id = ${uid}
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

  getByHiveId: async function (hiveId, uid) {
    const files = await storage().query(
      sql`SELECT t2.id, t2.user_id, t2.filename, t3.frame_side_id, t3.strokeHistory, t2.url_version, t2.hash, t2.ext
				FROM files t2
				INNER JOIN files_frame_side_rel t3 ON t3.file_id = t2.id
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