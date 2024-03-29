import fs from 'fs';
import FormData from 'form-data';

import { logger } from '../logger';
import config from '../config';
import { publisher, generateChannelName } from '../redisPubSub';

import frameSideCells from "../models/frameSideCells";

import { DetectedFrameResource } from './types';
import { downloadAndUpdateResolutionInDB } from './downloadFile';

export async function detectCells(file) {
	await frameSideCells.startDetection(file.file_id, file.frame_side_id);

	logger.info(`Detecting frame resources of file id ${file.file_id}, frameside ${file.frame_side_id}`);

	try {
		logger.info(`Reading tmp file ${file.localFilePath}`);

		const fileContents = fs.readFileSync(file.localFilePath);
		const formData = new FormData();
		formData.append('file', fileContents, { type: 'application/octet-stream', filename: file.filename });

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
		const delta = convertDetectedResourcesStorageFormat(res, file.width, file.height);

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
	finally{
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

export function roundToDecimal(num: number, decimalPlaces: number): number {
	const multiplier = Math.pow(10, decimalPlaces);
	return Math.round(num * multiplier) / multiplier;
}

export async function analyzeCells() {
	const file = await frameSideCells.getFirstUnprocessedCells();

	if (file == null) {
		setTimeout(analyzeCells, 10000);
		return;
	}

	logger.info('starting processing file');
	logger.info({ file });

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

