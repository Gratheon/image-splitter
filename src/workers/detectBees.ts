import fs from 'fs';
import FormData from 'form-data';

import { logger } from '../logger';

import fileModel from '../models/file';
import * as imageModel from '../models/image';
import frameSideModel, { CutPosition, DetectedObject, convertDetectedBeesStorageFormat } from '../models/frameSide';

import config from '../config';
import { publisher, generateChannelName } from '../redisPubSub';

export async function detectBees(file) {
	let width, height, partialFilePath;

	await frameSideModel.startDetection(file.file_id, file.frame_side_id);

	let results: DetectedObject[] = [];

	let splitCountX = Math.round(file.width / 1440);
	let splitCountY = Math.round(file.height / 1080);

	logger.info(`Detecting bees in file id ${file.file_id}, frameside ${file.frame_side_id}. Will cut image in parts for better precision`);
	for (let x = 0; x < splitCountX; x++) {
		for (let y = 0; y < splitCountY; y++) {
			width = Math.floor(file.width / splitCountX);
			height = Math.floor(file.height / splitCountY);
			partialFilePath = `/app/tmp/${file.user_id}_${x}${y}_${file.filename}`;

			const cutPosition: CutPosition = {
				width,
				height,
				left: x * width,
				top: y * height
			};

			logger.info(`Cutting file ${file.localFilePath}, at ${x}x${y}`, cutPosition);
			await imageModel.cutImage(file, cutPosition, partialFilePath)

			logger.info(`Analyzing file id ${file.file_id}, frameside ${file.frame_side_id}, part cut at ${x}x${y}`);
			try {
				const fileContents = fs.readFileSync(partialFilePath);
				const formData = new FormData();
				formData.append('file', fileContents, { type: 'application/octet-stream', filename: file.filename });

				logger.info('Making request to ' + config.yolo_v5_url);
				const response = await fetch(config.yolo_v5_url, {
					method: 'POST',
					body: formData,
				});
				logger.info('received response from yolo v5 model');

				if (!response.ok) {
					logger.info('Response is not ok', response);
					await frameSideModel.updateDetectedBees(
						results,
						file.file_id,
						file.frame_side_id
					);

					logger.info('Removing temp file');
					fs.unlinkSync(partialFilePath);
					throw new Error(`HTTP request failed with status ${response.status}`);
				}

				const res = await response.json();
				logger.info('Parsed response from yolo v5 model to JSON', res);

				logger.info('Converting JSON to more compact format');
				const delta = convertDetectedBeesStorageFormat(res.result, cutPosition, splitCountX, splitCountY);

				logger.info('Updating DB with found compact stats');
				await frameSideModel.updateDetectedBees(
					delta,
					file.file_id,
					file.frame_side_id
				);

				logger.info('Removing temp file');
				fs.unlinkSync(partialFilePath);

				logger.info('Publishing results to redis');
				publisher.publish(
					generateChannelName(
						file.user_id,
						'frame_side',
						file.frame_side_id,
						'bees_partially_detected'
					),
					JSON.stringify({
						delta,
						detectedWorkerBeeCount: await frameSideModel.getWorkerBeeCount(file.frame_side_id, file.user_id),
						detectedDroneCount: await frameSideModel.getDroneCount(file.frame_side_id, file.user_id),
						detectedQueenCount: await frameSideModel.getQueenCount(file.frame_side_id, file.user_id),
						isBeeDetectionComplete: await frameSideModel.isComplete(file.frame_side_id, file.user_id)
					})
				);
			}
			catch (e) {
				logger.error("detectBees failed");
				console.error(e);
			}
		}
	}

	await frameSideModel.endDetection(file.file_id, file.frame_side_id);

	// push isBeeDetectionComplete
	publisher.publish(
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