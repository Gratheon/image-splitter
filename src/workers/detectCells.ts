import fs from 'fs';
import FormData from 'form-data';

import { logger } from '../logger';
import config from '../config';
import { publisher, generateChannelName } from '../redisPubSub';

import frameSideCells from "../models/frameSideCells";

import { DetectedFrameResource } from './types';
import { downloadAndUpdateResolutionInDB } from './downloadFile';
import { roundToDecimal } from './common';

export async function detectCells(file) {
	await frameSideCells.startDetection(file.file_id, file.frame_side_id);

	logger.info(`Detecting frame resources of file id ${file.file_id}, frameside ${file.frame_side_id}`);

	try {
		logger.info(`Reading tmp file ${file.localFilePath}`);

		const fileContents = fs.readFileSync(file.localFilePath);
		const formData = new FormData();
		formData.append('file', fileContents, { type: 'application/octet-stream', filename: file.filename });

		let delta:any = [];
		// in dev skip cell analysis as this model is too heavy
		if (process.env.ENV_ID === 'dev') {
			delta = [
				[5, 0.3852, 0.6097, 0.0044, 75],
				[5, 0.2828, 0.5689, 0.0044, 100],
				[4, 0.3829, 0.5298, 0.0044, 85],
				[5, 0.2174, 0.5515, 0.0044, 100],
				[5, 0.2822, 0.4907, 0.0044, 100],
				[5, 0.5189, 0.2737, 0.0044, 100],
				[5, 0.6069, 0.3814, 0.0044, 100],
				[6, 0.3673, 0.5185, 0.0044, 79],
				[4, 0.3412, 0.4829, 0.0044, 100],
				[5, 0.3893, 0.3492, 0.0044, 100],
				[4, 0.4315, 0.4742, 0.0044, 100],
				[5, 0.4541, 0.4065, 0.0044, 100],
				[6, 0.3164, 0.4465, 0.0044, 50],
				[4, 0.3551, 0.3649, 0.0044, 99]
			]
		}
		else {
			logger.info("Making request to " + config.models_frame_resources_url);
			logger.info("fileContents length is " + fileContents.length);
			const response = await fetch(config.models_frame_resources_url, {
				method: 'POST',
				body: formData,
			});

			if (!response.ok) {
				throw new Error(`HTTP request failed with status ${response.status}`);
			}

			logger.info(`Received frame resource ok response`);
			const res = await response.json();

			logger.info("Parsed frame resource response as JSON");

			logger.info("Converting frame resource response to more compact form");
			delta = convertDetectedResourcesStorageFormat(res, file.width, file.height);
		}

		const relativeCounts = await frameSideCells.updateDetectedCells(
			delta,
			file.file_id,
			file.frame_side_id
		);


		const ch = generateChannelName(
			file.user_id, 'frame_side',
			file.frame_side_id, 'frame_resources_detected'
		);

		logger.info("Publishing frame resources to redis channel", ch);
		await publisher.publish(
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
	}
	catch (e) {
		logger.error("Frame resource detection failed");
		console.error(e);
	}
	finally {
		await frameSideCells.endDetection(file.file_id, file.frame_side_id);
	}
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

export async function analyzeCells() {
	const file = await frameSideCells.getFirstUnprocessedCells();

	if (file == null) {
		setTimeout(analyzeCells, 10000);
		return;
	}

	logger.info('starting processing file', { file });

	try {
		await downloadAndUpdateResolutionInDB(file);

		logger.info(`making parallel requests to detect cells for file ${file.file_id}`);
		await detectCells(file);

		fs.unlinkSync(file.localFilePath);
	}
	catch (e) {
		logger.error(e);
	}

	setTimeout(analyzeCells, 500);
}

