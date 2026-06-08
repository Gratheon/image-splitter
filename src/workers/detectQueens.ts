import fetch from "node-fetch";
import FormData from "form-data";

import config from '../config';
import { logger } from '../logger';

import frameSideModel, { CutPosition, DetectedObject } from '../models/frameSide';
import fileSideModel, { FrameSideFetchedByFileId } from '../models/frameSide';
import { resolveThresholdFromPayload } from "../models/detectionSettings";

import { generateChannelName, publisher } from '../redisPubSub';
import { retryAsyncFunction, roundToDecimal, splitIn9ImagesAndDetect } from './common/common';
import { downloadS3FileToLocalTmp } from "./common/downloadFile";

type QueenDetectorResponse = {
    message?: string;
    result?: QueenDetectorDetection[];
};

type QueenDetectorDetection = {
    class_id?: number;
    class_name?: string;
    confidence?: number;
    box?: number[];
};

type ImageDimensions = {
    width: number;
    height: number;
};

function appendQueryParam(url: string, key: string, value: string | number): string {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function isQueenDetection(detection: QueenDetectorDetection): boolean {
    if (typeof detection.class_name === 'string') {
        return detection.class_name.toLowerCase().includes('queen');
    }

    // models-queen-bee-detector is currently a single-class YOLO model where class 0 is queen.
    return detection.class_id === undefined || detection.class_id === 0;
}

export function normalizeQueenDetection(
    detection: QueenDetectorDetection,
    cutPosition: CutPosition,
    originalImage: ImageDimensions
): DetectedObject | null {
    if (!detection || !Array.isArray(detection.box) || detection.box.length < 4) {
        logger.warn('normalizeQueenDetection: invalid detection box', { detection });
        return null;
    }

    if (!isQueenDetection(detection)) {
        return null;
    }

    const confidence = Number(detection.confidence);
    const [rawX1, rawY1, rawX2, rawY2] = detection.box.map(Number);

    if (
        !Number.isFinite(confidence) ||
        !Number.isFinite(rawX1) ||
        !Number.isFinite(rawY1) ||
        !Number.isFinite(rawX2) ||
        !Number.isFinite(rawY2) ||
        !Number.isFinite(originalImage.width) ||
        !Number.isFinite(originalImage.height) ||
        originalImage.width <= 0 ||
        originalImage.height <= 0
    ) {
        logger.warn('normalizeQueenDetection: non-finite detection or image dimensions', { detection, originalImage });
        return null;
    }

    const x1 = clamp(rawX1 + cutPosition.left, 0, originalImage.width);
    const y1 = clamp(rawY1 + cutPosition.top, 0, originalImage.height);
    const x2 = clamp(rawX2 + cutPosition.left, 0, originalImage.width);
    const y2 = clamp(rawY2 + cutPosition.top, 0, originalImage.height);

    const width = x2 - x1;
    const height = y2 - y1;

    if (width <= 0 || height <= 0) {
        logger.warn('normalizeQueenDetection: invalid normalized box dimensions', { detection, cutPosition, originalImage });
        return null;
    }

    return {
        n: '3',
        x: roundToDecimal(((x1 + x2) / 2) / originalImage.width, 5),
        y: roundToDecimal(((y1 + y2) / 2) / originalImage.height, 5),
        w: roundToDecimal(width / originalImage.width, 4),
        h: roundToDecimal(height / originalImage.height, 4),
        c: roundToDecimal(confidence, 2),
    };
}

export async function detectQueens(ref_id, payload) {
    const file = await frameSideModel.getFrameSideByFileId(ref_id);

    if (file == null) {
        throw new Error(`frameSideModel.getFrameSideByFileId failed and did not find any file ${ref_id} not found`);
    }

    logger.info('detectQueens - processing file', {
        fileId: file.file_id,
        frameSideId: file.frame_side_id,
        userId: file.user_id,
        filename: file.filename,
        width: file.width,
        height: file.height,
    });

    await downloadS3FileToLocalTmp(file);

    const minConfidence = resolveThresholdFromPayload(payload, "queens");

    logger.info(`Making chunked requests to detect queens for file ${file.file_id}`, {
        modelUrl: config.models_queen_bee_detector_url,
        minConfidence,
    });

    await splitIn9ImagesAndDetect(file, 1024, async (chunkBytes: Buffer, cutPosition: CutPosition) => {
        await analyzeQueens(chunkBytes, cutPosition, file, minConfidence);
    });
}

export async function analyzeQueens(
    chunkBytes: Buffer,
    cutPosition: CutPosition,
    originalFile: FrameSideFetchedByFileId,
    minConfidence: number
): Promise<DetectedObject[]> {
    const validDetections = await retryAsyncFunction(
        () => askQueenBeeDetector(chunkBytes, cutPosition, originalFile, minConfidence),
        3
    ) as DetectedObject[];

    logger.info(`Queen detection result for chunk ${cutPosition.x},${cutPosition.y}:`, validDetections);

    await fileSideModel.updateQueens(
        validDetections,
        originalFile.frame_side_id,
        originalFile.user_id
    );

    publisher().publish(
        generateChannelName(
            originalFile.user_id, 'frame_side',
            originalFile.frame_side_id, 'queens_detected'
        ),
        JSON.stringify({
            delta: validDetections,
            isQueenDetectionComplete: true
        })
    );

    return validDetections;
}

async function askQueenBeeDetector(
    chunkBytes: Buffer,
    cutPosition: CutPosition,
    originalFile: FrameSideFetchedByFileId,
    minConfidence: number
): Promise<DetectedObject[]> {
    const formData = new FormData();
    formData.append('file', chunkBytes, {
        filename: `queen_chunk_${cutPosition.x}_${cutPosition.y}_${originalFile.filename}`,
        contentType: 'image/jpeg',
    });

    const modelUrl = appendQueryParam(config.models_queen_bee_detector_url, 'conf', minConfidence);

    logger.info(`Asking models-queen-bee-detector to detect queen on chunk for file ${originalFile.file_id} (${originalFile.filename}) at ${cutPosition.x},${cutPosition.y}`, {
        modelUrl,
    });

    const response = await fetch(modelUrl, {
        method: 'POST',
        body: formData,
        headers: formData.getHeaders(),
    });

    if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to read error body');
        logger.error(`Queen detector API request failed for file ${originalFile.file_id}, chunk ${cutPosition.x},${cutPosition.y}`, {
            status: response.status,
            statusText: response.statusText,
            body: errorBody,
            modelUrl,
        });
        throw new Error(`Queen detector API request failed, status: ${response.status} ${response.statusText}`);
    }

    const body = await response.json() as QueenDetectorResponse;
    const detections = Array.isArray(body.result) ? body.result : [];
    const result: DetectedObject[] = [];

    for (const detection of detections) {
        const confidence = Number(detection?.confidence);
        if (!Number.isFinite(confidence) || confidence < minConfidence) {
            continue;
        }

        const normalizedDetection = normalizeQueenDetection(detection, cutPosition, originalFile);
        if (normalizedDetection) {
            result.push(normalizedDetection);
        }
    }

    logger.info(`Queen result for chunk ${cutPosition.x},${cutPosition.y}: Found ${result.length} potential queens above threshold.`, {
        detectorMessage: body.message,
        rawDetectionCount: detections.length,
    });
    logger.debug('Queen result details:', result);

    return result;
}
