import fetch from "node-fetch";

import { logger } from "../logger";
import config from "../config";

import frameSideModel, {
  convertDetectedBeesStorageFormat,
  CutPosition,
  DetectedObject,
} from "../models/frameSide";

import { generateChannelName, publisher } from "../redisPubSub";
import { downloadS3FileToLocalTmp } from "./common/downloadFile";
import jobs, { TYPE_BEES, NOTIFY_JOB } from "../models/jobs";
import { splitIn9ImagesAndDetect, roundToDecimal } from "./common/common"; // Added roundToDecimal

// Define expected structure for the detection service response
interface DetectionResponse {
  message: string;
  result: DetectionResultItem[];
}

interface DetectionResultItem {
  class_id: number;
  class_name: string; // Although not used in the logic, good for typing
  confidence: number;
  box: [number, number, number, number]; // [x1, y1, x2, y2]
}

// Define the structure for the processed bee object (matches existing DetectedObject)
interface ProcessedBee {
  n: string; // class_id as string
  x: number; // normalized center x
  y: number; // normalized center y
  w: number; // normalized width
  h: number; // normalized height
  c: number; // confidence
}


export async function detectWorkerBees(ref_id: number, payload: any) { // Reverted ref_id type to number
  // Convert number ref_id to string for getFrameSideByFileId
  const file = await frameSideModel.getFrameSideByFileId(String(ref_id));

  if (file == null) {
    throw new Error(`File ${ref_id} not found`);
  }

  logger.info("detectWorkerBees - processing file", file);
  await downloadS3FileToLocalTmp(file);

  await splitIn9ImagesAndDetect(
    file,
    1024,
    // async processor for every split sub-image
    // all we need to do is take formData and send it to the model, store the results
    async (file: any, cutPosition: CutPosition, formData: any) => {
      await runDetectionOnSplitImage(file, cutPosition, formData);
    },
  );
}

async function runDetectionOnSplitImage(
  file: any,
  cutPosition: CutPosition,
  formData: any,
) {
  const detectedBees = await fetch(config.yolo_v5_url, {
    method: "POST",
    body: formData,
  });

  if (detectedBees.ok) {
    const res: DetectionResponse = await detectedBees.json();

    // Log the received response from the detection service
    logger.info('Received detection response:', { fileId: file.file_id, frameSideId: file.frame_side_id, response: res });

    const newDetectedBees: ProcessedBee[] = [];
    // Define typeMap locally (mapping from class name/id to stored 'n' value)
    // Based on frameSide.js, the stored 'n' is the string version of the class ID.
    // Note: This map might need adjustment if class IDs change in the model
    const typeMap = {
        'BEE_WORKER': '0',
        'BEE_DRONE': '1',
        'BEE_WORKER_ALTERNATE': '2',
        'BEE_QUEEN': '3'
    };
    const queenClassIdString = typeMap.BEE_QUEEN; // '3'

    if (res.result && Array.isArray(res.result)) {
        for (const det of res.result) {
            // Ensure detection has expected structure (basic check)
            if (!det || typeof det !== 'object' || !det.box || det.box.length !== 4 || det.class_id === undefined || det.confidence === undefined) {
                logger.warn('Skipping invalid detection object:', det);
                continue;
            }

            const detectionClassIdString = String(det.class_id);

            // Filter out queens based on class ID string
            if (detectionClassIdString === queenClassIdString) {
                continue;
            }

            // Calculate absolute pixel coordinates in the original image
            // det.box provides [x1, y1, x2, y2] relative to the cut image
            const x1_abs = det.box[0] + cutPosition.left;
            const y1_abs = det.box[1] + cutPosition.top;
            const x2_abs = det.box[2] + cutPosition.left;
            const y2_abs = det.box[3] + cutPosition.top;

            // Calculate center, width, height in absolute pixels
            const x_center_abs = (x1_abs + x2_abs) / 2;
            const y_center_abs = (y1_abs + y2_abs) / 2;
            const width_abs = x2_abs - x1_abs;
            const height_abs = y2_abs - y1_abs;

            // Normalize coordinates relative to the original image dimensions (file.width, file.height)
            const x_final_norm = x_center_abs / file.width;
            const y_final_norm = y_center_abs / file.height;
            const w_final_norm = width_abs / file.width;
            const h_final_norm = height_abs / file.height;

            newDetectedBees.push({
                n: detectionClassIdString, // Use class_id as string 'n'
                x: roundToDecimal(x_final_norm, 5),
                y: roundToDecimal(y_final_norm, 5),
                w: roundToDecimal(w_final_norm, 4),
                h: roundToDecimal(h_final_norm, 4),
                c: roundToDecimal(det.confidence, 2)
            });
        }
    } else {
         logger.warn('Received empty or invalid result array from detection service:', res.result);
    }

     if (newDetectedBees.length > 0) {
        await frameSideModel.updateDetectedBees(
          newDetectedBees,
          file.file_id,
          file.frame_side_id,
          file.user_id,
        );
     }

    const redisChannelName = generateChannelName(
      file.user_id,
      "frame_side",
      file.frame_side_id,
      "bees_partially_detected",
    );

    jobs.addJob(NOTIFY_JOB, file.file_id, {
      redisChannelName,
      payload: {
        delta: newDetectedBees,
        detectedWorkerBeeCount: await frameSideModel.getWorkerBeeCount(
          file.frame_side_id,
          file.user_id,
        ),
        detectedDroneCount: await frameSideModel.getDroneCount(
          file.frame_side_id,
          file.user_id,
        ),
        detectedQueenCount: await frameSideModel.getQueenCount(
          file.frame_side_id,
          file.user_id,
        ),
        isBeeDetectionComplete: await jobs.isComplete(TYPE_BEES, file.id),
      },
    });
  } else {
    logger.error("Response is not ok", detectedBees);
    logger.error(`HTTP request failed with status ${detectedBees.status}`);
  }
}
