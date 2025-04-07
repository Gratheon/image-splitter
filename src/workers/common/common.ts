// @ts-ignore
import fs from "fs";
// @ts-ignore
import FormData from "form-data";

import {logger} from "../../logger";
import frameSideModel, {CutPosition, FrameSideFetchedByFileId} from "../../models/frameSide";
import * as imageModel from "../../models/image";
import {generateChannelName, publisher} from "../../redisPubSub";


export async function splitIn9ImagesAndDetect(file: FrameSideFetchedByFileId, subImageDimensionPx = 800, subImageHandler: Function) {
    logger.info(`splitIn9ImagesAndDetect: Starting for file_id ${file.file_id}, frame_side_id ${file.frame_side_id}`);


    let maxCutsX = 1;
    let maxCutsY = 1;

    if (file.width > subImageDimensionPx) {
        maxCutsX = Math.floor(file.width / subImageDimensionPx);
    }

    if (file.width > subImageDimensionPx) {
        maxCutsY = Math.floor(file.height / subImageDimensionPx);
    }
    logger.info(`splitIn9ImagesAndDetect: Calculated cuts: ${maxCutsX} x ${maxCutsY}`);

    // read once to reuse it in all sub-images
    file.imageBytes = fs.readFileSync(file.localFilePath);

    if (file.imageBytes.length < 1000) {
        logger.warn('Image seems too small. Maybe a bad S3 response?', fs.readFileSync(file.localFilePath, 'utf8'));
    }

    const processCut = async (x,y, file) => {
        let width, height;

        width = Math.floor(file.width / maxCutsX);
        height = Math.floor(file.height / maxCutsY);

        const cutPosition: CutPosition = {
            x, y,
            maxCutsX, maxCutsY,
            width, height,
            left: x * width, top: y * height,
        };

        logger.info(`Cutting file ${file.localFilePath}, at ${x}x${y}`, cutPosition);

        let partialImageBytes: Buffer = await imageModel.cutImage(file, cutPosition);

        logger.info(`Read ${partialImageBytes.length} bytes`);
        const formData = new FormData();
        formData.append('file', partialImageBytes, {
            // @ts-ignore
            type: 'application/octet-stream',
            filename: file.filename
        });

        logger.info(`splitIn9ImagesAndDetect - calling subImageHandler`, {
            filename: file.filename,
            file_id: file.file_id
        });

        await subImageHandler(file, cutPosition, formData);
    }

    // Process sequentially instead of concurrently
    let partCounter = 0;
    for (let x = 0; x < maxCutsX; x++) {
        for (let y = 0; y < maxCutsY; y++) {
            partCounter++;
            logger.info(`splitIn9ImagesAndDetect: Processing part ${partCounter} (x=${x}, y=${y}) sequentially...`);
            try {
                await processCut(x, y, file); // Await each part directly
                logger.info(`splitIn9ImagesAndDetect: Finished processing part ${partCounter} (x=${x}, y=${y})`);
            } catch (partError) {
                // Log error for the specific part but continue processing others
                logger.error(`splitIn9ImagesAndDetect: Error processing part ${partCounter} (x=${x}, y=${y})`, partError);
                // Depending on requirements, you might want to:
                // - Stop processing entirely: throw partError;
                // - Mark the overall job as failed later
            }
        }
    }

    // logger.info(`splitIn9ImagesAndDetect: Finished sequential processing attempt for all ${partCounter} parts. Publishing completion message.`);
    // push isBeeDetectionComplete
    // publisher().publish(
    //     generateChannelName(
    //         file.user_id,
    //         'frame_side',
    //         file.frame_side_id,
    //         'bees_partially_detected'
    //     ),
    //     JSON.stringify({
    //         delta: [],
    //         detectedWorkerBeeCount: await frameSideModel.getWorkerBeeCount(file.frame_side_id, file.user_id),
    //         detectedDroneCount: await frameSideModel.getDroneCount(file.frame_side_id, file.user_id),
    //         detectedQueenCount: await frameSideModel.getQueenCount(file.frame_side_id, file.user_id),
    //         isBeeDetectionComplete: true
    //     })
    // );
}

export async function retryAsyncFunction(asyncFunction, maxRetries, DELAY_SEC = 60) {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            return await asyncFunction();
        } catch (error) {
            logger.warn(`Attempt ${retries + 1} failed`);
            logger.error(error);
            retries++;
            if (retries < maxRetries) {
                await sleep(DELAY_SEC)
            }
        }
    }
    throw new Error(`Exceeded maximum retries (${maxRetries}).`);
}

export async function sleep(sec = 1) {
    // slow down API for security to slow down brute-force
    await new Promise(resolve => setTimeout(resolve, sec * 1000));
}


export function roundToDecimal(num: number, decimalPlaces: number): number {
    const multiplier = Math.pow(10, decimalPlaces);
    return Math.round(num * multiplier) / multiplier;
}

export function convertClarifaiCoords(bounding_box, cutPosition: CutPosition): any {
    const {top_row, left_col, bottom_row, right_col} = bounding_box

    let h = bottom_row - top_row;
    let w = right_col - left_col;
    let x = left_col + w / 2;
    let y = bottom_row - h / 2;

    if (cutPosition.maxCutsX > 0) {
        x = (Number(x) * cutPosition.width + cutPosition.left) / (cutPosition.maxCutsX * cutPosition.width)
        w = Number(w) / (cutPosition.maxCutsX)
    }

    if (cutPosition.maxCutsY > 0) {
        y = (Number(y) * cutPosition.height + cutPosition.top) / (cutPosition.maxCutsY * cutPosition.height)
        h = Number(h) / cutPosition.maxCutsY
    }

    return {
        x: roundToDecimal(x, 5),
        y: roundToDecimal(y, 5),
        h: roundToDecimal(h, 4),
        w: roundToDecimal(w, 4),
    }
}
