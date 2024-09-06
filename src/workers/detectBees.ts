// @ts-ignore
import fs from 'fs';
// @ts-ignore
import FormData from 'form-data';
import fetch from 'node-fetch';


import {logger} from '../logger';
import config from '../config';

import frameSideModel, {convertDetectedBeesStorageFormat, CutPosition, DetectedObject,} from '../models/frameSide';

import {generateChannelName, publisher} from '../redisPubSub';
import {downloadS3FileToLocalTmp} from './common/downloadFile';
import jobs, {TYPE_BEES} from "../models/jobs";
import {splitIn9ImagesAndDetect} from "./common/common";

export async function detectWorkerBees(ref_id, payload) {
    const file = await frameSideModel.getFrameSideByFileId(ref_id);

    if (file == null) {
        throw new Error(`File ${ref_id} not found`)
    }

    logger.info('detectWorkerBees - processing file', file);
    await downloadS3FileToLocalTmp(file);

    await splitIn9ImagesAndDetect(file, 1024,
        // async processor for every split sub-image
        // all we need to do is take formData and send it to the model, store the results
        async (file: any, cutPosition: CutPosition, formData: any) => {
            await runDetectionOnSplitImage(file, cutPosition, formData)
        });
}

async function runDetectionOnSplitImage(file: any, cutPosition: CutPosition, formData: any) {
    const detectedBees = await fetch(config.yolo_v5_url, {
        method: 'POST',
        body: formData,
    })

    if (detectedBees.ok) {
        const res = await detectedBees.json();

        let newDetectedBees: DetectedObject[] = convertDetectedBeesStorageFormat(res.result, cutPosition);

        await frameSideModel.updateDetectedBees(
            newDetectedBees,
            file.file_id,
            file.frame_side_id,
            file.user_id
        );

        const redisChannelName = generateChannelName(
            file.user_id, 'frame_side',
            file.frame_side_id, 'bees_partially_detected'
        )
        logger.info(`Publishing detectBees results to redis ${redisChannelName}`);
        publisher().publish(
            redisChannelName,
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