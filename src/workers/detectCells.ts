// @ts-ignore
import fs from 'fs';
// @ts-ignore
import FormData from 'form-data';
import fetch from 'node-fetch';

import {logger} from '../logger';
import config from '../config';
import {generateChannelName, publisher} from '../redisPubSub';

import frameSideCells, {FirstUnprocessedFile} from "../models/frameSideCells";

import {DetectedFrameResource} from './types';
import {downloadS3FileToLocalTmp} from './common/downloadFile';
import {roundToDecimal} from './common/common';

export async function detectCells(file: FirstUnprocessedFile)   {
    logger.info(`Detecting frame resources of file id ${file.file_id}, frameside ${file.frame_side_id}`);
    logger.info(`Reading tmp file ${file.localFilePath}`);

    const fileContents = fs.readFileSync(file.localFilePath);
    const formData = new FormData();
    formData.append('file', fileContents, {
        // @ts-ignore
        type: 'application/octet-stream',
        filename: file.filename
    });

    let delta: any = [];
    logger.info("Making request to " + config.models_frame_resources_url);
    logger.info("fileContents length is " + fileContents.length);

    // must use fetch from node-fetch, otherwise it will fail with TypeError: fetch failed + SocketError: other side closed
    const response = await fetch(config.models_frame_resources_url, {
        method: 'POST',
        // @ts-ignore
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`HTTP request failed with status ${response.status}`);
    }

    logger.info(`Received frame resource ok response`);
    const res = await response.json();

    logger.info("Converting frame resource response to more compact form");
    delta = convertDetectedResourcesStorageFormat(res, file.width, file.height);

    const relativeCounts = await frameSideCells.updateDetectedCells(
        delta,
        file.file_id,
        file.frame_side_id
    );

    const ch = generateChannelName(
        file.user_id, 'frame_side',
        file.frame_side_id, 'frame_resources_detected'
    );

    logger.info("Publishing frame resources to redis channel " + ch);
    await publisher().publish(
        ch,
        JSON.stringify({
            delta,
            isCellsDetectionComplete: true,

            broodPercent: relativeCounts.brood,
            cappedBroodPercent: relativeCounts.capped_brood,
            eggsPercent: relativeCounts.eggs,
            pollenPercent: relativeCounts.pollen,
            honeyPercent: relativeCounts.honey
        })
    );

    const ch2 = generateChannelName(
        file.user_id, 'hive',
        file.hive_id, 'frame_resources_detected'
    );

    logger.info("Publishing frame resources to redis channel " + ch2);
    await publisher().publish(
        ch2,
        JSON.stringify({
            delta,
            isCellsDetectionComplete: true,
            frameSideId: file.frame_side_id,

            broodPercent: relativeCounts.brood,
            cappedBroodPercent: relativeCounts.capped_brood,
            eggsPercent: relativeCounts.eggs,
            pollenPercent: relativeCounts.pollen,
            honeyPercent: relativeCounts.honey
        })
    );
}

export function convertDetectedResourcesStorageFormat(detectedResources, width, height): DetectedFrameResource[] {
    const result: DetectedFrameResource[] = [];

    for (let line of detectedResources) {
        result.push([
            line[3],
            roundToDecimal(line[0] / width, 4),
            roundToDecimal(line[1] / height, 4),
            roundToDecimal(line[2] / width, 4),
            Math.ceil(line[5] * 100),
        ]);
    }

    return result;
}

export async function analyzeCells(ref_id, payload) {
    const file = await frameSideCells.getCellsByFileId(ref_id);

    if (file == null) {
        throw new Error(`Cells entry with file_id ${ref_id} not found`)
    }

    logger.info('starting detecting cells for file', {file});

    await downloadS3FileToLocalTmp(file);

    logger.info(`making parallel requests to detect cells for file ${file.file_id}`);
    await detectCells(file);
}

