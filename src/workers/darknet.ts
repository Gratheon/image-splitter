import Jimp from 'jimp';
import fs from 'fs';
import https from 'https';
import FormData from 'form-data';

import { logger } from '../logger';
import fileModel from '../models/file';
import config from '../config'

async function downloadFile(url, localPath) {
	return new Promise((resolve, reject) => {
		try {
			const file = fs.createWriteStream(localPath);
			const request = https.get(url, function (response) {
				response.pipe(file);

				// after download completed close filestream
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

type CutPosition = {
	width: number
	height: number
	left: number
	top: number
}

async function getImageAndAddYoloAnnotations() {
	const file = await fileModel.getFirstUnprocessedFile();

	if (file == null) {
		setTimeout(getImageAndAddYoloAnnotations, 5000);
		logger.info('empty queue, 5s..');
		return
	}

	logger.info('starting processing file');
	logger.info({ file });

	if (!fs.existsSync(file.localFilePath)) {
		await downloadFile(file.url, file.localFilePath);
	}

	await fileModel.startDetection(file.file_id, file.frame_side_id);

	let width, height, partialFilePath;

	let results: DetectedObject[] = [];

	if (file.width === null || file.height === null) {
		const image = await Jimp.read(file.localFilePath)
		file.width = image.bitmap.width;
		file.height = image.bitmap.height;

		await fileModel.updateDimentions({
			width: file.width,
			height: file.height,
		}, file.file_id);
	}

	let splitCountX = Math.round(file.width / 1440)
	let splitCountY = Math.round(file.height / 1080)

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

			logger.info(`analyzing file id ${file.file_id}, frameside ${file.frame_side_id} at ${x}x${y}`);
			try {
				const fileContents = fs.readFileSync(partialFilePath);
				const formData = new FormData();
				formData.append('file', fileContents, { type: 'application/octet-stream', filename: file.filename });

				const response = await fetch(config.yolo_v5_url, {
					method: 'POST',
					body: formData,
				});

				if (!response.ok) {
					await fileModel.updateDetections(
						results,
						file.file_id,
						file.frame_side_id
					)

					fs.unlinkSync(partialFilePath);
					throw new Error(`HTTP request failed with status ${response.status}`);
				}

				const res = await response.json();
				results = [
					...results,
					...parseYoloText(res.result, cutPosition, splitCountX, splitCountY),
				];

				logger.info('results ', results);

				await fileModel.updateDetections(
					results,
					file.file_id,
					file.frame_side_id
				)

				fs.unlinkSync(partialFilePath);
			}
			catch (e) {
				logger.error(e);
			}
		}
	}

	await fileModel.endDetection(file.file_id, file.frame_side_id);
	fs.unlinkSync(file.localFilePath);

	setTimeout(getImageAndAddYoloAnnotations, 500);
}


export default function init() {
	getImageAndAddYoloAnnotations();
};

export function parseYoloText(txt: string, cutPosition: CutPosition, splitCountX, splitCountY): DetectedObject[] {

	const result: DetectedObject[] = [];
	const lines = txt.split("\n");

	for (let line of lines) {
		if (line.length < 5) continue;

		const [n, x, y, w, h, c] = line.split(' ');
		console.log({ cutPosition, line });
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

function roundToDecimal(num: number, decimalPlaces: number): number {
	const multiplier = Math.pow(10, decimalPlaces);
	return Math.round(num * multiplier) / multiplier;
}