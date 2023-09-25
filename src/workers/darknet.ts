import Jimp from 'jimp';
import fs from 'fs';
import https from 'https';
import FormData from 'form-data';

import { logger } from '../logger';
import fileModel from '../models/file';
import config from '../config';
import { publisher, generateChannelName } from '../redisPubSub'

async function downloadFile(url, localPath) {
	return new Promise((resolve, reject) => {
		try {
			const file = fs.createWriteStream(localPath);
			https.get(url, function (response) {
				response.pipe(file);

				file.on("finish", () => {
					file.close();
					logger.info("Download Completed");
					resolve(true);
				});
			});
		} catch (e) {
			reject(e);
		}
	});
}

type DetectedObject = {
	n: String, // class
	x: number
	y: number
	w: number
	h: number
	c: number // confidence
}

type DetectedFrameResource = [
	number, // class: ["Capped", "Eggs", "Honey", "Larves", "Nectar", "Other", "Pollen"]
	number, // x
	number, // y
	number, // radius
	number // probability
]

type CutPosition = {
	width: number
	height: number
	left: number
	top: number
}

async function analyzeImage() {
	const file = await fileModel.getFirstUnprocessedFile();

	if (file == null) {
		setTimeout(analyzeImage, 10000);
		logger.info('empty queue, 10s..');
		return
	}

	logger.info('starting processing file');
	logger.info({ file });

	try {
		if (!fs.existsSync(file.localFilePath)) {
			await downloadFile(file.url, file.localFilePath);
		}

		await fileModel.startDetection(file.file_id, file.frame_side_id);

		if (file.width === null || file.height === null) {
			const image = await Jimp.read(file.localFilePath)
			file.width = image.bitmap.width;
			file.height = image.bitmap.height;

			await fileModel.updateDimentions({
				width: file.width,
				height: file.height,
			}, file.file_id);
		}

		await Promise.all([
			detectBees(file),
			detectFrameResources(file),
		])

		await fileModel.endDetection(file.file_id, file.frame_side_id);
		fs.unlinkSync(file.localFilePath);
	}
	catch (e) {
		logger.error(e)
	}

	setTimeout(analyzeImage, 500);
}

async function detectFrameResources(file) {
	logger.info(`Detecting frame resources of file id ${file.file_id}, frameside ${file.frame_side_id}`);
	try {
		logger.info(`Reading tmp file ${file.localFilePath}`)

		const fileContents = fs.readFileSync(file.localFilePath);
		const formData = new FormData();
		formData.append('file', fileContents, { type: 'application/octet-stream', filename: file.filename });

		logger.info("Making request to " + config.models_frame_resources_url)
		const response = await fetch(config.models_frame_resources_url, {
			method: 'POST',
			body: formData,
		});

		if (!response.ok) {
			throw new Error(`HTTP request failed with status ${response.status}`);
		}

		logger.info(`Received frame resource ok response`)
		const res = await response.json();

		logger.info("Parsed frame resource response as JSON")

		logger.info("Converting frame resource response to more compact form")
		const delta = convertDetectedResourcesStorageFormat(res, file.width, file.height)

		logger.info("Saving frame resource response to DB")
		await fileModel.updateDetectedResources(
			delta,
			file.file_id,
			file.frame_side_id
		)

		const ch = generateChannelName(
			file.user_id,
			'frame_side',
			file.frame_side_id,
			'frame_resources_detected'
		);

		logger.info("Publishing frame resources to redis channel", ch)
		await publisher.publish(
			ch, 
			JSON.stringify({
				delta
			})
		)
	}
	catch (e) {
		logger.error("Frame resource detection failed", e);
	}
}

async function detectBees(file) {
	let width, height, partialFilePath;

	let results: DetectedObject[] = [];

	let splitCountX = Math.round(file.width / 1440)
	let splitCountY = Math.round(file.height / 1080)

	logger.info(`Detecting bees in file id ${file.file_id}, frameside ${file.frame_side_id}. Will cut image in parts for better precision`);
	for (let x = 0; x < splitCountX; x++) {
		for (let y = 0; y < splitCountY; y++) {
			width = Math.floor(file.width / splitCountX)
			height = Math.floor(file.height / splitCountY)
			partialFilePath = `/app/tmp/${file.user_id}_${x}${y}_${file.filename}`;

			const cutPosition: CutPosition = {
				width,
				height,
				left: x * width,
				top: y * height
			};

			let j1 = await Jimp.read(file.localFilePath)
			let j2 = j1.crop(
				cutPosition.left,
				cutPosition.top,
				cutPosition.width,
				cutPosition.height,
			)
			await j2.writeAsync(partialFilePath)

			logger.info(`Analyzing file id ${file.file_id}, frameside ${file.frame_side_id}, part cut at ${x}x${y}`);
			try {
				const fileContents = fs.readFileSync(partialFilePath);
				const formData = new FormData();
				formData.append('file', fileContents, { type: 'application/octet-stream', filename: file.filename });

				logger.info('Making request to ' + config.yolo_v5_url)
				const response = await fetch(config.yolo_v5_url, {
					method: 'POST',
					body: formData,
				});
				logger.info('received response from yolo v5 model')

				if (!response.ok) {
					logger.info('Response is not ok', response)
					await fileModel.updateDetectedBees(
						results,
						file.file_id,
						file.frame_side_id
					)

					logger.info('Removing temp file')
					fs.unlinkSync(partialFilePath);
					throw new Error(`HTTP request failed with status ${response.status}`);
				}

				const res = await response.json();
				logger.info('Parsed response from yolo v5 model to JSON', res)

				logger.info('Converting JSON to more compact format')
				const delta = convertDetectedBeesStorageFormat(res.result, cutPosition, splitCountX, splitCountY)

				results = [
					...results,
					...delta,
				];

				logger.info('Updating DB with found compact stats')
				await fileModel.updateDetectedBees(
					results,
					file.file_id,
					file.frame_side_id
				)

				logger.info('Removing temp file')
				fs.unlinkSync(partialFilePath);

				logger.info('Publishing results to redis')
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
				)
			}
			catch (e) {
				logger.error(`Failed to process file id ${file.file_id}, frameside ${file.frame_side_id} at ${x}x${y}`,e);
			}
		}
	}
}


export default function init() {
	analyzeImage();
};

export function convertDetectedBeesStorageFormat(txt: string, cutPosition: CutPosition, splitCountX, splitCountY): DetectedObject[] {
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
		})
	}

	return result;
}

export function convertDetectedResourcesStorageFormat(detectedResources, width, height): DetectedFrameResource[] {
	const result: DetectedFrameResource[] = [];

	for (let line of detectedResources) {
		result.push([
			line[3], //class			
			roundToDecimal(line[0] / width, 4),
			roundToDecimal(line[1] / height, 4),
			roundToDecimal(line[2] / width, 4),
			Math.ceil(line[5] * 100),
		])
	}

	return result;
}

function roundToDecimal(num: number, decimalPlaces: number): number {
	const multiplier = Math.pow(10, decimalPlaces);
	return Math.round(num * multiplier) / multiplier;
}
