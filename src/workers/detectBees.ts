import fs from 'fs';
import FormData from 'form-data';

import { logger } from '../logger';
import config from '../config';

import * as imageModel from '../models/image';
import frameSideModel, { CutPosition, convertDetectedBeesStorageFormat } from '../models/frameSide';

import { publisher, generateChannelName } from '../redisPubSub';
import { detectVarroa } from './detectVarroa';
import { analyzeQueens } from './detectQueens';
import { downloadAndUpdateResolutionInDB } from './downloadFile';

export async function splitIn9ImagesAndDetect(file) {
	let width, height, partialFilePath;

	await frameSideModel.startDetection(file.file_id, file.frame_side_id);

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
				file.imageBytes = fs.readFileSync(partialFilePath);
				const formData = new FormData();
				formData.append('file', file.imageBytes, { type: 'application/octet-stream', filename: file.filename });

				await runDetectionOnSplitImage(file, partialFilePath, cutPosition, splitCountX, splitCountY, formData);
			}
			catch (e) {
				logger.error("detectBees failed");
				console.error(e);
			}


			logger.info('Removing temp file');
			fs.unlinkSync(partialFilePath);
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

async function runDetectionOnSplitImage(file: any, partialFilePath: any, cutPosition: CutPosition, splitCountX: number, splitCountY: number, formData: any) {
	const [
		detectedQueens, detectedVarroa, detectedBees
	] = await Promise.all([
		analyzeQueens(file),
		detectVarroa(partialFilePath, cutPosition, splitCountX, splitCountY),

		// detect bees
		fetch(config.yolo_v5_url, {
			method: 'POST',
			body: formData,
		})
	]);

	logger.info('received response from yolo v5 model');
	console.log('detectedQueens', detectedQueens);

	if (!detectedBees.ok) {
		logger.info('Response is not ok', detectedBees);
		await frameSideModel.updateDetectedBeesAndVarroa(
			[],
			detectedVarroa,
			file.file_id,
			file.frame_side_id
		);

		logger.info('Removing temp file');
		fs.unlinkSync(partialFilePath);
		throw new Error(`HTTP request failed with status ${detectedBees.status}`);
	}

	const res = await detectedBees.json();
	logger.info('Parsed response from yolo v5 model to JSON', res);


	let newDetectedBees = convertDetectedBeesStorageFormat(res.result, cutPosition, splitCountX, splitCountY);

	logger.info('Updating DB with found compact stats');
	await frameSideModel.updateDetectedBeesAndVarroa(
		newDetectedBees,
		detectedVarroa,
		file.file_id,
		file.frame_side_id
	);
	logger.info('Publishing results to redis');
	publisher.publish(
		generateChannelName(
			file.user_id, 'frame_side',
			file.frame_side_id, 'bees_partially_detected'
		),
		JSON.stringify({
			delta: newDetectedBees,
			detectedWorkerBeeCount: await frameSideModel.getWorkerBeeCount(file.frame_side_id, file.user_id),
			detectedDroneCount: await frameSideModel.getDroneCount(file.frame_side_id, file.user_id),
			detectedQueenCount: await frameSideModel.getQueenCount(file.frame_side_id, file.user_id),
			isBeeDetectionComplete: await frameSideModel.isComplete(file.frame_side_id, file.user_id)
		})
	);
}

export async function analyzeBeesAndVarroa() {
	const file = await frameSideModel.getFirstUnprocessedBees();

	if (file == null) {
		setTimeout(analyzeBeesAndVarroa, 10000);
		return;
	}

	logger.info('starting processing file');
	logger.info({ file });

	try {
		await downloadAndUpdateResolutionInDB(file);

		logger.info(`making parallel requests to detect objects for file ${file.file_id}`);
		await splitIn9ImagesAndDetect(file);

		fs.unlinkSync(file.localFilePath);
	}
	catch (e) {
		logger.error(e);
	}

	setTimeout(analyzeBeesAndVarroa, 500);
}

