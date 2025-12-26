import { sql } from "@databases/mysql";

import { storage } from "./storage";
import config from "../config/index";

const fileModel = {
  getUrl(file) {
    if (file.url_version == 1) {
      return `${config.aws.url.public}${file.user_id}/${file.filename}`
    } else {
      return `${config.aws.url.public}${file.user_id}/${file.hash}/original${file.ext ? "." + file.ext : ''}`
    }
  },

  updateDimentions: async function ({ width, height }, fileId: number) {
    await storage().query(
      sql`UPDATE files SET width=${width}, height=${height} WHERE id=${fileId}`
    );
  },

  getByFrameSideId: async function (id, uid) {
    const result = await storage().query(
      sql`SELECT t2.id, t2.width, t2.height, t2.url_version, t2.ext, t2.hash, t2.user_id

			FROM files_frame_side_rel t1
			LEFT JOIN files t2 ON t1.file_id = t2.id
			WHERE t1.frame_side_id = ${id} AND t1.user_id = ${uid} AND t1.inspection_id IS NULL
			LIMIT 1`
    );

    const file = result[0];

    if (!file) {
      return null;
    }

    return {
      __typename: "File",
      ...file,
      url: fileModel.getUrl(file),
    };
  },

  getByFrameSideAndInspectionId: async function (id, inspectionId, uid) {
    const result = await storage().query(
      sql`SELECT t1.user_id, t2.filename, t1.strokeHistory, t1.detected_bees, 
      t2.id, t2.width, t2.height, t2.url_version, t2.ext, t2.hash, t2.user_id,
      t3.cells

			FROM files_frame_side_rel t1
			LEFT JOIN files t2 ON t1.file_id = t2.id
      LEFT JOIN files_frame_side_cells t3 ON t1.file_id=t3.file_id AND t1.inspection_id = t3.inspection_id
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
      ...file,
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

  getHiveStatistics: async function (hiveId, uid) {
    const frameSideStats = await storage().query(
      sql`SELECT 
        COALESCE(SUM(t2.worker_bee_count), 0) as workerBeeCount,
        COALESCE(SUM(t2.drone_count), 0) as droneCount,
        COALESCE(SUM(t2.varroa_count), 0) as varroaCountFrames
				FROM files_hive_rel t1
				INNER JOIN files_frame_side_rel t2 ON t2.file_id = t1.file_id
				WHERE t1.user_id = ${uid} AND t1.hive_id=${hiveId} AND t2.inspection_id IS NULL`
    );

    const bottomVarroaStats = await storage().query(
      sql`SELECT COALESCE(SUM(vbd.varroa_count), 0) as varroaCountBottom
        FROM varroa_bottom_detections vbd
        INNER JOIN files_box_rel fbr ON fbr.file_id = vbd.file_id
        INNER JOIN files_hive_rel fhr ON fhr.file_id = vbd.file_id
        WHERE vbd.user_id = ${uid} 
          AND fhr.hive_id = ${hiveId}
          AND fbr.inspection_id IS NULL`
    );

    const stats = frameSideStats[0] || { workerBeeCount: 0, droneCount: 0, varroaCountFrames: 0 };
    const varroaBottom = bottomVarroaStats[0]?.varroaCountBottom || 0;
    const workerBeeCount = stats.workerBeeCount || 0;

    return {
      workerBeeCount,
      droneCount: 0,
      varroaCount: (stats.varroaCountFrames || 0) + varroaBottom
    };
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
      sql`SELECT id, user_id, filename, hash, url_version, ext, width, height -- Select all needed fields
			FROM files
			WHERE id=${id} and user_id=${uid}
			LIMIT 1`
    );

    const file = result[0];

    if (!file) {
      return null;
    }

    return {
      __typename: "File",
      ...file, // Return all selected fields
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
