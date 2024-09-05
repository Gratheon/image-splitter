// @ts-ignore
import fs from 'fs';
// @ts-ignore
import FormData from 'form-data';

import {logger} from '../logger';
import config from '../config';

import * as imageModel from '../models/image';
import frameSideModel, {
    convertDetectedBeesStorageFormat,
    CutPosition,
    DetectedObject,
    FrameSideFetchedByFileId
} from '../models/frameSide';

import {generateChannelName, publisher} from '../redisPubSub';
import {downloadAndUpdateResolutionInDB} from './downloadFile';
import jobs, {TYPE_BEES} from "../models/jobs";

export async function detectWorkerBees(ref_id, payload) {
    const file = await frameSideModel.getFrameSideByFileId(ref_id);

    if (file == null) {
        throw new Error(`File ${ref_id} not found`)
    }

    logger.info('AnalyzeBeesAndVarroa - processing file', file);
    await downloadAndUpdateResolutionInDB(file);

    logger.info(`Making parallel requests to detect objects for file ${file.file_id}`);
    await splitIn9ImagesAndDetect(file, 1024, async (file: any, cutPosition: CutPosition, formData: any)=>{
        await runDetectionOnSplitImage(file, cutPosition, formData)
    });
}


export async function splitIn9ImagesAndDetect(file: FrameSideFetchedByFileId, subImageDimensionPx = 800, subImageHandler: Function) {
    let width, height, partialFilePath;

    let maxCutsX = 1;
    let maxCutsY = 1;

    if (file.width > subImageDimensionPx) {
        maxCutsX = Math.floor(file.width / subImageDimensionPx);
    }

    if (file.width > subImageDimensionPx) {
        maxCutsY = Math.floor(file.height / subImageDimensionPx);
    }

    logger.info(`Detecting bees. Will cut image in parts for better precision`, {
        fileId: file.file_id,
        frameSideId: file.frame_side_id,
        file
    });

    for (let x = 0; x < maxCutsX; x++) {
        for (let y = 0; y < maxCutsY; y++) {
            width = Math.floor(file.width / maxCutsX);
            height = Math.floor(file.height / maxCutsY);
            partialFilePath = `/app/tmp/${file.user_id}_${file.file_id}_${subImageDimensionPx}_${x}${y}_${file.filename}`;

            if(fs.existsSync(partialFilePath)) {
                logger.info('Cut file already exists, skipping resizing', partialFilePath);
                continue;
            }

            const cutPosition: CutPosition = {
                x, y,
                maxCutsX, maxCutsY,
                width, height,
                left: x * width, top: y * height,
            };

            logger.info(`Cutting file ${file.localFilePath}, at ${x}x${y}`, cutPosition);

            await imageModel.cutImage(file, cutPosition, partialFilePath);

            file.imageBytes = fs.readFileSync(partialFilePath);
            const formData = new FormData();
            formData.append('file', file.imageBytes, {
                // @ts-ignore
                type: 'application/octet-stream',
                filename: file.filename
            });

            await subImageHandler(file, cutPosition, formData);

            logger.info('Removing temp file');
            // fs.unlinkSync(partialFilePath);
        }
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

async function runDetectionOnSplitImage(file: any, cutPosition: CutPosition, formData: any) {
    const detectedBees = await fetch(config.yolo_v5_url, {
        method: 'POST',
        body: formData,
    })

    if (detectedBees.ok) {
        const res = await detectedBees.json();
        // log('Parsed response from yolo v5 model to JSON', res);

        let newDetectedBees: DetectedObject[] = convertDetectedBeesStorageFormat(
            res.result, cutPosition);

        await frameSideModel.updateDetectedBees(
            newDetectedBees,
            file.file_id,
            file.frame_side_id,
            file.user_id
        );

        logger.info('Publishing results to redis');
        publisher().publish(
            generateChannelName(
                file.user_id, 'frame_side',
                file.frame_side_id, 'bees_partially_detected'
            ),
            JSON.stringify({
                delta: newDetectedBees,
                detectedWorkerBeeCount: await frameSideModel.getWorkerBeeCount(file.frame_side_id, file.user_id),
                detectedDroneCount: await frameSideModel.getDroneCount(file.frame_side_id, file.user_id),
                detectedQueenCount: await frameSideModel.getQueenCount(file.frame_side_id, file.user_id),
                isBeeDetectionComplete: await jobs.isComplete(TYPE_BEES, file.id)
            })
        );
    } else {
        logger.error('Response is not ok', detectedBees);
        logger.error(`HTTP request failed with status ${detectedBees.status}`);
    }
}