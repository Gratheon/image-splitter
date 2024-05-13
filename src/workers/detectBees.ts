import fs from 'fs';
import FormData from 'form-data';

import { log, logger } from '../logger';
import config from '../config';

import * as imageModel from '../models/image';
import frameSideModel, { CutPosition, DetectedObject, convertDetectedBeesStorageFormat } from '../models/frameSide';

import { publisher, generateChannelName } from '../redisPubSub';
import { analyzeAndUpdateVarroa } from './detectVarroa';
import { analyzeQueens as analyzeAndUpdateQueens } from './detectQueens';
import { downloadAndUpdateResolutionInDB } from './downloadFile';

export async function splitIn9ImagesAndDetect(file) {
	let width, height, partialFilePath;

	try {
		await frameSideModel.startDetection(file.file_id, file.frame_side_id);

		let maxCutsX = 1;
		let maxCutsY = 1;

		if (file.width > 512) {
			maxCutsX = Math.floor(file.width / 512);
		}

		if (file.width > 512) {
			maxCutsY = Math.floor(file.height / 512);
		}

		logger.info(`Detecting bees in file id ${file.file_id}, frameside ${file.frame_side_id}. Will cut image in parts for better precision`);
		log("file dimensions", file)

		for (let x = 0; x < maxCutsX; x++) {
			for (let y = 0; y < maxCutsY; y++) {
				width = Math.floor(file.width / maxCutsX);
				height = Math.floor(file.height / maxCutsY);
				partialFilePath = `/app/tmp/${file.user_id}_${x}${y}_${file.filename}`;

				const cutPosition: CutPosition = {
					x,
					y,
					maxCutsX,
					maxCutsY,

					width,
					height,
					left: x * width,
					top: y * height,
				};

				log(`Cutting file ${file.localFilePath}, at ${x}x${y}`, cutPosition);
				await subImageDetect(
					file,
					partialFilePath,
					cutPosition
				);
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
	} catch (e) {
		logger.error(e);
	}
}

async function subImageDetect(file: any, partialFilePath: any, cutPosition: CutPosition) {
	await imageModel.cutImage(file, cutPosition, partialFilePath);

	try {
		file.imageBytes = fs.readFileSync(partialFilePath);
		const formData = new FormData();
		formData.append('file', file.imageBytes, { type: 'application/octet-stream', filename: file.filename });

		await runDetectionOnSplitImage(file, cutPosition, formData);
	}
	catch (e) {
		logger.error("detectBees failed");
		console.error(e);
	}

	log('Removing temp file');
	fs.unlinkSync(partialFilePath);
}

async function runDetectionOnSplitImage(
	file: any,
	cutPosition: CutPosition,
	formData: any) {

	try {
		// run these together as they depend on same vendor (Clarifai)
		await Promise.all([
			analyzeAndUpdateQueens(file, cutPosition),
			analyzeAndUpdateVarroa(file, cutPosition)
		])

	} catch (e) {
		logger.error('Failed to analyze queens');
		logger.error(e);
	}

	try {
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
		else {
			logger.error('Response is not ok', detectedBees);
			logger.error(`HTTP request failed with status ${detectedBees.status}`);
		}
	} catch (e) {
		logger.error('Failed to analyze bees');
	}
}

export async function analyzeBeesAndVarroa() {
	const file = await frameSideModel.getFirstUnprocessedBees();

	if (file == null) {
		setTimeout(analyzeBeesAndVarroa, 10000);
		return;
	}

	log('AnalyzeBeesAndVarroa - processing file', file);

	try {
		await downloadAndUpdateResolutionInDB(file);

		log(`Making parallel requests to detect objects for file ${file.file_id}`);
		await splitIn9ImagesAndDetect(file);

		fs.unlinkSync(file.localFilePath);
	}
	catch (e) {
		logger.error(e);
	}

	setTimeout(analyzeBeesAndVarroa, 500);
}

