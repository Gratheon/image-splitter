// @ts-ignore
import fs from "fs";
// @ts-ignore
import FormData from "form-data";
import fetch from "node-fetch";

import { logger } from "../logger";
import config from "../config";
import { generateChannelName, publisher } from "../redisPubSub";

import frameSideCells, { FirstUnprocessedFile } from "../models/frameSideCells";
import jobs, { NOTIFY_JOB } from "../models/jobs";

import { DetectedFrameResource } from "./types";
import { downloadS3FileToLocalTmp } from "./common/downloadFile";
import { roundToDecimal } from "./common/common";

export async function detectCells(file: FirstUnprocessedFile) {
  logger.info(
    `Detecting frame resources of file id ${file.file_id}, frameside ${file.frame_side_id}`,
  );
  logger.info(`Reading tmp file ${file.localFilePath}`);

  const fileContents = fs.readFileSync(file.localFilePath);
  const formData = new FormData();
  formData.append("file", fileContents, {
    // @ts-ignore
    type: "application/octet-stream",
    filename: file.filename,
  });

  let delta: any = [];
  logger.info("Making request to " + config.models_frame_resources_url);
  logger.info("fileContents length is " + fileContents.length);

  // must use fetch from node-fetch, otherwise it will fail with TypeError: fetch failed + SocketError: other side closed
  const response = await fetch(config.models_frame_resources_url, {
    method: "POST",
    // @ts-ignore
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`HTTP request failed with status ${response.status}`);
  }

  logger.info(`Received frame resource ok response`);
  const res = await response.json();
  logger.info("Received frame resource response:", res); // Log the raw response

  // Ensure the response has the expected 'result' property which should be an array
  if (!res || !Array.isArray(res.result)) {
      logger.error("Invalid response format received from frame resource service. 'result' array not found or not an array.", res);
      // Handle the error appropriately, maybe throw or return early
      // For now, let's assume an empty delta if the format is wrong
      delta = [];
  } else {
      logger.info("Converting frame resource response to more compact form");
      // Pass the actual array (res.result) to the conversion function
      delta = convertDetectedResourcesStorageFormat(res.result, file.width, file.height);
  }

  const relativeCounts = await frameSideCells.updateDetectedCells(
    delta,
    file.file_id,
    file.frame_side_id,
  );

  const ch = generateChannelName(
    file.user_id,
    "frame_side",
    file.frame_side_id,
    "frame_resources_detected",
  );

  logger.info("Publishing frame resources to redis channel " + ch);
  await publisher().publish(
    ch,
    JSON.stringify({
      delta,
      isCellsDetectionComplete: true,

      broodPercent: relativeCounts.brood,
      cappedBroodPercent: relativeCounts.capped_brood,
      eggsPercent: relativeCounts.eggs,
      pollenPercent: relativeCounts.pollen,
      honeyPercent: relativeCounts.honey,
    }),
  );

  const ch2 = generateChannelName(
    file.user_id,
    "hive",
    file.hive_id,
    "frame_resources_detected",
  );

  jobs.addJob(NOTIFY_JOB, file.file_id, {
    redisChannelName: ch2,
    payload: {
      delta,
      isCellsDetectionComplete: true,
      frameSideId: file.frame_side_id,

      broodPercent: relativeCounts.brood,
      cappedBroodPercent: relativeCounts.capped_brood,
      eggsPercent: relativeCounts.eggs,
      pollenPercent: relativeCounts.pollen,
      honeyPercent: relativeCounts.honey,
    },
  });

  //  logger.info("Publishing frame resources to redis channel " + ch2);
  //  await publisher().publish(
  //      ch2,
  //      JSON.stringify({
  //          delta,
  //          isCellsDetectionComplete: true,
  //          frameSideId: file.frame_side_id,

  //          broodPercent: relativeCounts.brood,
  //          cappedBroodPercent: relativeCounts.capped_brood,
  //          eggsPercent: relativeCounts.eggs,
  //          pollenPercent: relativeCounts.pollen,
  //          honeyPercent: relativeCounts.honey
  //      })
  //  );
}

export function convertDetectedResourcesStorageFormat(
  detectedResources,
  width,
  height,
): DetectedFrameResource[] {
  // The check Array.isArray(detectedResources) is now redundant here
  // because we ensure it's an array before calling this function.
  // We can remove the check here for cleaner code, or keep it as a safeguard.
  // Let's keep it for now as an extra safeguard.
  if (!Array.isArray(detectedResources)) {
    logger.error(
      "Error inside convertDetectedResourcesStorageFormat: Input is not an array. Value:",
      detectedResources,
    );
    return [];
  }
  const result: DetectedFrameResource[] = [];

  for (const line of detectedResources) { // Use const for loop variable
    // Basic check for line structure might be useful too, but start with the array check.
    result.push([
      line[3], // Class ID
      roundToDecimal(line[0] / width, 4),
      roundToDecimal(line[1] / height, 4),
      roundToDecimal(line[2] / width, 4),
      Math.ceil(line[5] * 100),
    ]);
  }

  return result;
}

export async function analyzeCells(ref_id, payload) {
  const file = await frameSideCells.getCellsByFileId(ref_id);

  if (file == null) {
    throw new Error(`Cells entry with file_id ${ref_id} not found`);
  }

  logger.info("starting detecting cells for file", { file });

  await downloadS3FileToLocalTmp(file);

  logger.info(
    `making parallel requests to detect cells for file ${file.file_id}`,
  );
  await detectCells(file);
}
