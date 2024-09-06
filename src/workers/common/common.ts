// @ts-ignore
import fs from "fs";
// @ts-ignore
import FormData from "form-data";

import {logger} from "../../logger";
import frameSideModel, {CutPosition, FrameSideFetchedByFileId} from "../../models/frameSide";
import * as imageModel from "../../models/image";
import {generateChannelName, publisher} from "../../redisPubSub";


export async function splitIn9ImagesAndDetect(file: FrameSideFetchedByFileId, subImageDimensionPx = 800, subImageHandler: Function) {
    logger.info('splitIn9ImagesAndDetect - will splitting file into smaller parts', file);


    let maxCutsX = 1;
    let maxCutsY = 1;

    if (file.width > subImageDimensionPx) {
        maxCutsX = Math.floor(file.width / subImageDimensionPx);
    }

    if (file.width > subImageDimensionPx) {
        maxCutsY = Math.floor(file.height / subImageDimensionPx);
    }

    // read once to reuse it in all sub-images
    file.imageBytes = fs.readFileSync(file.localFilePath);

    if (file.imageBytes.length < 1000) {
        logger.warn('Image seems too small. Maybe a bad S3 response?', fs.readFileSync(file.localFilePath, 'utf8'));
    }

    const processCut = async (x,y, file) => {
        let width, height, partialFilePath;

        width = Math.floor(file.width / maxCutsX);
        height = Math.floor(file.height / maxCutsY);
        partialFilePath = `/app/tmp/${file.user_id}_${file.file_id}_${subImageDimensionPx}_${x}${y}_${file.filename}`;

        if (fs.existsSync(partialFilePath)) {
            logger.info('Cut file already exists, skipping resizing', partialFilePath);
            return;
        }

        const cutPosition: CutPosition = {
            x, y,
            maxCutsX, maxCutsY,
            width, height,
            left: x * width, top: y * height,
        };

        logger.info(`Cutting file ${file.localFilePath}, at ${x}x${y}`, cutPosition);

        let partialImageBytes: Buffer = await imageModel.cutImage(file, cutPosition, partialFilePath);

        // logger.info(`Reading partial file ${partialFilePath}`);

        // let partialImageBytes: Buffer = fs.readFileSync(partialFilePath);
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
        // logger.info('Removing temp file');
        // fs.unlinkSync(partialFilePath);
    }

    const parallelPromises = []
    for (let x = 0; x < maxCutsX; x++) {
        for (let y = 0; y < maxCutsY; y++) {
            parallelPromises.push(processCut(x,y, file))

            // run 3 in parallel
            if(parallelPromises.length >= 3) {
                await Promise.all(parallelPromises)
                parallelPromises.length = 0
            }
        }
    }

    if(parallelPromises.length > 0) {
        await Promise.all(parallelPromises)
    }

    // push isBeeDetectionComplete
    publisher().publish(
        generateChannelName(
            file.user_id,
            'frame_side',
            file.frame_side_id,
            'bees_partially_detected'
        ),
        JSON.stringify({
            delta: [],
            detectedWorkerBeeCount: await frameSideModel.getWorkerBeeCount(file.frame_side_id, file.user_id),
            detectedDroneCount: await frameSideModel.getDroneCount(file.frame_side_id, file.user_id),
            detectedQueenCount: await frameSideModel.getQueenCount(file.frame_side_id, file.user_id),
            isBeeDetectionComplete: true
        })
    );
}

export async function retryAsyncFunction(asyncFunction, maxRetries, DELAY_SEC = 60) {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            return await asyncFunction();
        } catch (error) {
            logger.warn(`Attempt ${retries + 1} failed`);
            logger.warn(error);
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