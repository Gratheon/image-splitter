import fetch from "node-fetch";
import FormData from "form-data"; // Import FormData

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
    async (chunkBytes: Buffer, cutPosition: CutPosition, fileId: number, filename: string) => {
      // Pass correct arguments to runDetectionOnSplitImage
      // We also need the original 'file' object for context later, so pass it along
      await runDetectionOnSplitImage(chunkBytes, cutPosition, fileId, filename, file);
    },
  );

  // After ALL chunks are processed, send final completion notification
  logger.info("detectWorkerBees - all chunks processed, sending final notification", {
    fileId: file.file_id,
    frameSideId: file.frame_side_id
  });

  const finalChannelName = generateChannelName(
    file.user_id,
    "frame_side",
    file.frame_side_id,
    "bees_detected", // Note: different channel name for completion
  );

  const finalCounts = {
    detectedWorkerBeeCount: await frameSideModel.getWorkerBeeCount(file.frame_side_id, file.user_id),
    detectedDroneCount: await frameSideModel.getDroneCount(file.frame_side_id, file.user_id),
    detectedQueenCount: await frameSideModel.getQueenCount(file.frame_side_id, file.user_id),
  };

  logger.info("detectWorkerBees - final counts", finalCounts);

  // Send final completion via NOTIFY_JOB for proper delivery
  await jobs.addJob(NOTIFY_JOB, file.file_id, {
    redisChannelName: finalChannelName,
    payload: {
      ...finalCounts,
      isBeeDetectionComplete: true,
    },
  }, 1); // High priority for user notifications
}

// Updated function signature to accept correct arguments
async function runDetectionOnSplitImage(
  chunkBytes: Buffer,
  cutPosition: CutPosition,
  fileId: number, // Renamed from file for clarity, as it's just the ID here
  filename: string, // Added filename
  originalFile: any, // Pass the original file object for context (width, height, user_id etc.)
) {
  // Create FormData and append the image chunk
  const formData = new FormData();
  // Use a filename that the server might expect, or a generic one
  formData.append('file', chunkBytes, { filename: `chunk_${cutPosition.x}_${cutPosition.y}_${filename}` });

  logger.debug(`Sending chunk ${cutPosition.x},${cutPosition.y} for file ${fileId} to ${config.yolo_v5_url}`);

  const detectedBees = await fetch(config.yolo_v5_url, {
    method: "POST",
    body: formData, // Send the constructed FormData
    // Headers might be set automatically by node-fetch when using FormData,
    // but you could explicitly set {'Content-Type': 'multipart/form-data'} if needed,
    // though it often requires boundary calculation which FormData handles.
  });

  if (detectedBees.ok) {
    const res: DetectionResponse = await detectedBees.json();

    // Log the received response from the detection service
    // Use originalFile for context IDs
    logger.info('Received detection response:', { 
      fileId: originalFile.file_id, 
      frameSideId: originalFile.frame_side_id, 
      resultCount: res.result?.length || 0 
    });

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

            // Normalize coordinates relative to the original image dimensions (originalFile.width, originalFile.height)
            const x_final_norm = x_center_abs / originalFile.width;
            const y_final_norm = y_center_abs / originalFile.height;
            const w_final_norm = width_abs / originalFile.width;
            const h_final_norm = height_abs / originalFile.height;

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
        // Use originalFile for context IDs
        await frameSideModel.updateDetectedBees(
          newDetectedBees,
          originalFile.file_id,
          originalFile.frame_side_id,
          originalFile.user_id,
        );
     }

    // Use originalFile for context IDs
    const redisChannelName = generateChannelName(
      originalFile.user_id,
      "frame_side",
      originalFile.frame_side_id,
      "bees_partially_detected",
    );

    // jobs.addJob(NOTIFY_JOB, file.file_id, {
    //   redisChannelName,
    //   payload: {
    //     delta: newDetectedBees,
    //     detectedWorkerBeeCount: await frameSideModel.getWorkerBeeCount(
    //       file.frame_side_id,
    //       file.user_id,
    //     ),
    //     detectedDroneCount: await frameSideModel.getDroneCount(
    //       file.frame_side_id,
    //       file.user_id,
    //     ),
    //     detectedQueenCount: await frameSideModel.getQueenCount(
    //       file.frame_side_id,
    //       file.user_id,
    //     ),
    //     isBeeDetectionComplete: await jobs.isComplete(TYPE_BEES, file.id),
    //   },
    // });

        // Use originalFile for context IDs
        publisher().publish(redisChannelName,
        JSON.stringify({
            delta: newDetectedBees,
            detectedWorkerBeeCount: await frameSideModel.getWorkerBeeCount(originalFile.frame_side_id, originalFile.user_id),
            detectedDroneCount: await frameSideModel.getDroneCount(originalFile.frame_side_id, originalFile.user_id),
            detectedQueenCount: await frameSideModel.getQueenCount(originalFile.frame_side_id, originalFile.user_id),
            isBeeDetectionComplete: false // Partial results, not complete yet
        }));


  } else {
    logger.error("Response is not ok", detectedBees);
    logger.error(`HTTP request failed with status ${detectedBees.status}`);
  }
}
