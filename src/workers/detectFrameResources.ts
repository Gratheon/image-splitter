import fs from 'fs';
import FormData from 'form-data';

import { logger } from '../logger';
import fileModel from '../models/file';
import config from '../config';
import { publisher, generateChannelName } from '../redisPubSub';

import { DetectedFrameResource, roundToDecimal } from './orchestrator';

export async function detectFrameResources(file) {
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

		logger.info("Saving frame resource response to DB");
		await fileModel.updateDetectedResources(
			delta,
			file.file_id,
			file.frame_side_id
		);

		const ch = generateChannelName(
			file.user_id,
			'frame_side',
			file.frame_side_id,
			'frame_resources_detected'
		);

		logger.info("Publishing frame resources to redis channel", ch);
		await publisher.publish(
			ch,
			JSON.stringify({
				delta
			})
		);
	}
	catch (e) {
		logger.error("Frame resource detection failed");
		console.error(e);
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

