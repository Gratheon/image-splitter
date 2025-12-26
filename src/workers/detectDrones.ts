import fetch from "node-fetch";
import FormData from "form-data";

import { logger } from "../logger";
import config from "../config";

import frameSideModel, {
  CutPosition,
} from "../models/frameSide";

import { generateChannelName, publisher } from "../redisPubSub";
import { downloadS3FileToLocalTmp } from "./common/downloadFile";
import { splitIn9ImagesAndDetect, roundToDecimal } from "./common/common";

interface DroneDetectionResponse {
  message: string;
  result: DetectionResultItem[];
  count: number;
  worker_count: number;
  drone_count: number;
}

interface DetectionResultItem {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
  class: number;
  class_name: string;
}

interface ProcessedDrone {
  n: string;
  x: number;
  y: number;
  w: number;
  h: number;
  c: number;
}

export async function detectDrones(ref_id: number, payload: any) {
  logger.info("detectDrones - starting job", { ref_id, payload });

  const file = await frameSideModel.getFrameSideByFileId(String(ref_id));

  if (file == null) {
    logger.error(`detectDrones - File ${ref_id} not found`);
    throw new Error(`File ${ref_id} not found`);
  }

  logger.info("detectDrones - processing file", {
    fileId: file.file_id,
    frameSideId: file.frame_side_id,
    userId: file.user_id,
    filename: file.filename,
    width: file.width,
    height: file.height
  });

  await downloadS3FileToLocalTmp(file);

  await splitIn9ImagesAndDetect(
    file,
    1024,
    async (chunkBytes: Buffer, cutPosition: CutPosition, fileId: number, filename: string) => {
      await runDroneDetectionOnSplitImage(chunkBytes, cutPosition, fileId, filename, file);
    },
  );
}

async function runDroneDetectionOnSplitImage(
  chunkBytes: Buffer,
  cutPosition: CutPosition,
  fileId: number,
  filename: string,
  originalFile: any,
) {
  const formData = new FormData();
  formData.append('file', chunkBytes, { filename: `chunk_${cutPosition.x}_${cutPosition.y}_${filename}` });

  logger.debug(`Sending chunk ${cutPosition.x},${cutPosition.y} for file ${fileId} to ${config.models_drone_bees_url}`);

  const detectionResponse = await fetch(config.models_drone_bees_url, {
    method: "POST",
    body: formData,
  });

  if (detectionResponse.ok) {
    const res: DroneDetectionResponse = await detectionResponse.json();

    logger.info('Received drone detection RAW response:', {
      fileId: originalFile.file_id,
      frameSideId: originalFile.frame_side_id,
      statusCode: detectionResponse.status,
      responseBody: JSON.stringify(res),
      resultCount: res.result?.length || 0,
      droneCount: res.drone_count,
      workerCount: res.worker_count
    });

    const newDetectedDrones: ProcessedDrone[] = [];
    const droneClassId = '1';

    if (res.result && Array.isArray(res.result)) {
      logger.info(`Processing ${res.result.length} detections from chunk`, {
        fileId: originalFile.file_id,
        chunkPosition: `${cutPosition.x},${cutPosition.y}`
      });

      for (const det of res.result) {
        if (!det || typeof det !== 'object' || det.x1 === undefined || det.confidence === undefined) {
          logger.warn('Skipping invalid detection object:', det);
          continue;
        }

        logger.debug('Processing detection:', {
          class_name: det.class_name,
          class_id: det.class,
          confidence: det.confidence,
          box: [det.x1, det.y1, det.x2, det.y2]
        });

        if (det.class !== 1) {
          logger.debug(`Skipping non-drone detection: class=${det.class}, class_name=${det.class_name}`);
          continue;
        }

        logger.info('Found DRONE detection!', {
          class_id: det.class,
          class_name: det.class_name,
          confidence: det.confidence
        });

        const x1_abs = det.x1 + cutPosition.left;
        const y1_abs = det.y1 + cutPosition.top;
        const x2_abs = det.x2 + cutPosition.left;
        const y2_abs = det.y2 + cutPosition.top;

        const x_center_abs = (x1_abs + x2_abs) / 2;
        const y_center_abs = (y1_abs + y2_abs) / 2;
        const width_abs = x2_abs - x1_abs;
        const height_abs = y2_abs - y1_abs;

        const x_final_norm = x_center_abs / originalFile.width;
        const y_final_norm = y_center_abs / originalFile.height;
        const w_final_norm = width_abs / originalFile.width;
        const h_final_norm = height_abs / originalFile.height;

        const processedDrone = {
          n: droneClassId,
          x: roundToDecimal(x_final_norm, 5),
          y: roundToDecimal(y_final_norm, 5),
          w: roundToDecimal(w_final_norm, 4),
          h: roundToDecimal(h_final_norm, 4),
          c: roundToDecimal(det.confidence, 2)
        };

        logger.info('Processed drone detection:', {
          original: { x1: det.x1, y1: det.y1, x2: det.x2, y2: det.y2 },
          normalized: processedDrone,
          imageSize: { width: originalFile.width, height: originalFile.height }
        });

        newDetectedDrones.push(processedDrone);
      }
    } else {
      logger.warn('Received empty or invalid result array from drone detection service:', {
        result: res.result,
        fileId: originalFile.file_id
      });
    }

    logger.info(`Detected ${newDetectedDrones.length} drones in chunk`, {
      fileId: originalFile.file_id,
      frameSideId: originalFile.frame_side_id,
      chunkPosition: `${cutPosition.x},${cutPosition.y}`
    });

    if (newDetectedDrones.length > 0) {
      logger.info('Storing drone detections in database', {
        fileId: originalFile.file_id,
        frameSideId: originalFile.frame_side_id,
        userId: originalFile.user_id,
        droneCount: newDetectedDrones.length,
        drones: newDetectedDrones
      });

      await frameSideModel.updateDetectedDrones(
        newDetectedDrones,
        originalFile.file_id,
        originalFile.frame_side_id,
        originalFile.user_id,
      );

      logger.info('Successfully stored drone detections', {
        fileId: originalFile.file_id,
        frameSideId: originalFile.frame_side_id
      });
    } else {
      logger.info('No drones detected in this chunk', {
        fileId: originalFile.file_id,
        chunkPosition: `${cutPosition.x},${cutPosition.y}`
      });
    }

    const redisChannelName = generateChannelName(
      originalFile.user_id,
      "frame_side",
      originalFile.frame_side_id,
      "drones_partially_detected",
    );

    publisher().publish(redisChannelName,
      JSON.stringify({
        delta: newDetectedDrones,
        detectedDroneCount: await frameSideModel.getDroneCount(originalFile.frame_side_id, originalFile.user_id),
        isDroneDetectionComplete: true
      }));

  } else {
    const errorBody = await detectionResponse.text().catch(() => 'Unable to read error body');
    logger.error("Drone detection API request failed", {
      status: detectionResponse.status,
      statusText: detectionResponse.statusText,
      url: config.models_drone_bees_url,
      errorBody: errorBody,
      fileId: originalFile.file_id,
      frameSideId: originalFile.frame_side_id,
      chunkPosition: `${cutPosition.x},${cutPosition.y}`
    });
  }
}

