import Jimp from 'jimp';
import fs from 'fs';
import FormData from 'form-data';

import { logger } from '../logger';
import fileModel from '../models/file';
import config from '../config';
import { publisher, generateChannelName } from '../redisPubSub';

import { CutPosition, DetectedObject, roundToDecimal } from './orchestrator';

export async function detectBees(file) {
	let width, height, partialFilePath;

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
			let j1 = await Jimp.read(file.localFilePath);
			let j2 = j1.crop(
				cutPosition.left,
				cutPosition.top,
				cutPosition.width,
				cutPosition.height
			);

			logger.info(`Writing cut to ${partialFilePath}`);
			await j2.writeAsync(partialFilePath);

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
					await fileModel.updateDetectedBees(
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

				results = [
					...results,
					...delta,
				];

				logger.info('Updating DB with found compact stats');
				await fileModel.updateDetectedBees(
					results,
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
						delta
					})
				);
			}

			catch (e) {
				logger.error("detectBees failed");
				console.error(e);
			}
		}
	}
}export function convertDetectedBeesStorageFormat(txt: string, cutPosition: CutPosition, splitCountX, splitCountY): DetectedObject[] {
	const result: DetectedObject[] = [];
	const lines = txt.split("\n");

	for (let line of lines) {
		if (line.length < 5) continue;

		const [n, x, y, w, h, c] = line.split(' ');
		result.push({
			n,
			x: roundToDecimal((Number(x) * cutPosition.width + cutPosition.left) / (splitCountX * cutPosition.width), 5),
			y: roundToDecimal((Number(y) * cutPosition.height + cutPosition.top) / (splitCountY * cutPosition.height), 5),
			w: roundToDecimal(Number(w) / splitCountX, 4),
			h: roundToDecimal(Number(h) / splitCountY, 4),
			c: roundToDecimal(Number(c), 2)
		});
	}

	return result;
}

