// @ts-ignore
import fs from 'fs';
// @ts-ignore
import FormData from 'form-data';
import fetch from 'node-fetch';


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
import {downloadAndUpdateResolutionInDB} from './common/downloadFile';
import jobs, {TYPE_BEES} from "../models/jobs";
import {splitIn9ImagesAndDetect} from "./common/common";

export async function detectWorkerBees(ref_id, payload) {
    const file = await frameSideModel.getFrameSideByFileId(ref_id);

    if (file == null) {
        throw new Error(`File ${ref_id} not found`)
    }

    logger.info('detectWorkerBees - processing file', file);
    await downloadAndUpdateResolutionInDB(file);

    await splitIn9ImagesAndDetect(file, 1024, async (file: any, cutPosition: CutPosition, formData: any)=>{
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