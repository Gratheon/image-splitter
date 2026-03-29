import { promises as fsPromises } from "fs";

import fetch from "node-fetch";
import FormData from "form-data";
import sharp from "sharp";

import config from "../config";
import { logger } from "../logger";
import frameSideModel, { DetectedObject } from "../models/frameSide";
import { storage } from "../models/storage";
import { generateChannelName, publisher } from "../redisPubSub";
import { resolveThresholdFromPayload } from "../models/detectionSettings";
import { downloadS3FileToLocalTmp } from "./common/downloadFile";
import { roundToDecimal } from "./common/common";

const VARROA_CLASS_ID = "11";
const BEE_CLASS_IDS = new Set(["0", "1", "2"]);
const BEE_CROP_PADDING_RATIO = 0.15;
const MIN_BEE_CROP_SIDE_PX = 24;

export const MIN_VARROA_CONFIDENCE = 0.65;

type BeeCropBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type VarroaServiceDetection = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
  class?: number;
  class_name?: string;
};

type VarroaServiceResponse = {
  message?: string;
  result?: VarroaServiceDetection[];
  count?: number;
};

const getVarroaKey = (varroa: { x: number; y: number; w: number }) => {
  const x = varroa.x.toFixed(4);
  const y = varroa.y.toFixed(4);
  const w = varroa.w.toFixed(4);
  return `${x}-${y}-${w}`;
};

export function buildBeeCropBounds(
  bee: DetectedObject,
  imageWidth: number,
  imageHeight: number,
  paddingRatio = BEE_CROP_PADDING_RATIO,
): BeeCropBounds | null {
  const centerX = Number(bee.x) * imageWidth;
  const centerY = Number(bee.y) * imageHeight;
  const widthPx = Math.max(MIN_BEE_CROP_SIDE_PX, Number(bee.w) * imageWidth);
  const heightPx = Math.max(MIN_BEE_CROP_SIDE_PX, Number(bee.h) * imageHeight);

  if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(widthPx) || !Number.isFinite(heightPx)) {
    return null;
  }

  const pad = Math.max(widthPx, heightPx) * Math.max(0, paddingRatio);

  const rawLeft = centerX - widthPx / 2 - pad;
  const rawTop = centerY - heightPx / 2 - pad;
  const rawRight = centerX + widthPx / 2 + pad;
  const rawBottom = centerY + heightPx / 2 + pad;

  const left = Math.max(0, Math.floor(rawLeft));
  const top = Math.max(0, Math.floor(rawTop));
  const right = Math.min(imageWidth, Math.ceil(rawRight));
  const bottom = Math.min(imageHeight, Math.ceil(rawBottom));

  const cropWidth = right - left;
  const cropHeight = bottom - top;

  if (cropWidth < MIN_BEE_CROP_SIDE_PX || cropHeight < MIN_BEE_CROP_SIDE_PX) {
    return null;
  }

  return {
    left,
    top,
    width: cropWidth,
    height: cropHeight,
  };
}

export function mapVarroaDetectionToOriginal(
  detection: VarroaServiceDetection,
  crop: BeeCropBounds,
  imageWidth: number,
  imageHeight: number,
): DetectedObject | null {
  const x1 = Number(detection.x1);
  const y1 = Number(detection.y1);
  const x2 = Number(detection.x2);
  const y2 = Number(detection.y2);
  const confidence = Number(detection.confidence);

  if (![x1, y1, x2, y2, confidence].every(Number.isFinite)) {
    return null;
  }

  const absX1 = crop.left + Math.max(0, Math.min(crop.width, x1));
  const absY1 = crop.top + Math.max(0, Math.min(crop.height, y1));
  const absX2 = crop.left + Math.max(0, Math.min(crop.width, x2));
  const absY2 = crop.top + Math.max(0, Math.min(crop.height, y2));

  const boxWidth = Math.max(0, absX2 - absX1);
  const boxHeight = Math.max(0, absY2 - absY1);

  if (boxWidth <= 0 || boxHeight <= 0) {
    return null;
  }

  const centerX = (absX1 + absX2) / 2;
  const centerY = (absY1 + absY2) / 2;

  return {
    n: VARROA_CLASS_ID,
    x: roundToDecimal(centerX / imageWidth, 5),
    y: roundToDecimal(centerY / imageHeight, 5),
    w: roundToDecimal(boxWidth / imageWidth, 4),
    h: roundToDecimal(boxHeight / imageHeight, 4),
    c: roundToDecimal(confidence, 2),
  };
}

async function detectVarroaOnBeeCrop(cropBytes: Buffer): Promise<VarroaServiceDetection[]> {
  const formData = new FormData();
  formData.append("file", cropBytes, { filename: "bee_crop.jpg" });

  const response = await fetch(config.models.varroaOnBeeUrl, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Varroa-on-bee model request failed with status ${response.status}`);
  }

  const body = (await response.json()) as VarroaServiceResponse;

  if (!Array.isArray(body.result)) {
    return [];
  }

  return body.result;
}

export async function detectVarroa(ref_id: number, payload: any) {
  const file = await frameSideModel.getFrameSideByFileId(String(ref_id));
  const minConfidence = resolveThresholdFromPayload(payload, "varroa");

  if (file == null) {
    throw new Error(`File ${ref_id} not found`);
  }

  logger.info("detectVarroaOnBees - processing file", {
    fileId: file.file_id,
    frameSideId: file.frame_side_id,
    userId: file.user_id,
  });

  await downloadS3FileToLocalTmp(file);

  const allDetectedBees = await frameSideModel.getDetectedBees(storage(), file.frame_side_id, file.file_id, file.user_id);
  const beeDetections = (allDetectedBees || []).filter((bee) => BEE_CLASS_IDS.has(String(bee.n)));

  if (beeDetections.length === 0) {
    logger.info("detectVarroaOnBees - no bee boxes found, finishing with zero varroa", {
      fileId: file.file_id,
      frameSideId: file.frame_side_id,
    });

    await frameSideModel.updateDetectedVarroa([], file.file_id, file.frame_side_id, file.user_id);

    publisher().publish(
      generateChannelName(file.user_id, "frame_side", file.frame_side_id, "varroa_detected"),
      JSON.stringify({
        delta: [],
        isVarroaDetectionComplete: true,
        varroaCount: 0,
      }),
    );

    return;
  }

  const imageBytes = await fsPromises.readFile(file.localFilePath);
  const allDetectedVarroa: DetectedObject[] = [];

  for (let index = 0; index < beeDetections.length; index++) {
    const bee = beeDetections[index];
    const cropBounds = buildBeeCropBounds(bee, file.width, file.height);

    if (!cropBounds) {
      logger.debug("detectVarroaOnBees - skipping bee with invalid crop bounds", {
        fileId: file.file_id,
        beeIndex: index,
        bee,
      });
      continue;
    }

    try {
      const cropBytes = await sharp(imageBytes)
        .extract({
          left: cropBounds.left,
          top: cropBounds.top,
          width: cropBounds.width,
          height: cropBounds.height,
        })
        .jpeg()
        .toBuffer();

      const cropDetections = await detectVarroaOnBeeCrop(cropBytes);

      for (const detection of cropDetections) {
        if (Number(detection.confidence) < minConfidence) {
          continue;
        }

        const mappedDetection = mapVarroaDetectionToOriginal(detection, cropBounds, file.width, file.height);
        if (mappedDetection) {
          allDetectedVarroa.push(mappedDetection);
        }
      }
    } catch (error) {
      logger.warn("detectVarroaOnBees - failed processing one bee crop, continuing", {
        fileId: file.file_id,
        beeIndex: index,
        frameSideId: file.frame_side_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const uniqueVarroaMap = new Map<string, DetectedObject>();
  allDetectedVarroa.forEach((mite) => {
    uniqueVarroaMap.set(getVarroaKey(mite), mite);
  });
  const finalUniqueVarroa = Array.from(uniqueVarroaMap.values());

  await frameSideModel.updateDetectedVarroa(finalUniqueVarroa, file.file_id, file.frame_side_id, file.user_id);

  publisher().publish(
    generateChannelName(file.user_id, "frame_side", file.frame_side_id, "varroa_detected"),
    JSON.stringify({
      delta: finalUniqueVarroa,
      isVarroaDetectionComplete: true,
      varroaCount: finalUniqueVarroa.length,
    }),
  );

  logger.info("detectVarroaOnBees - completed", {
    fileId: file.file_id,
    frameSideId: file.frame_side_id,
    beeCount: beeDetections.length,
    varroaCount: finalUniqueVarroa.length,
  });
}
