import Jimp from 'jimp';
import fs from 'fs';
import https from 'https';

import { logger } from '../logger';
import fileModel from '../models/file';
import { detectBees } from './detectBees';
import { detectFrameResources } from './detectFrameResources';
import { detectQueenCups } from './detectQueenCups';

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

export type DetectedObject = {
	n: String, // class
	// 10 - queen cup
	x: number
	y: number
	w: number
	h: number
	c: number // confidence
}

export type DetectedFrameResource = [
	number, // class: ["Capped", "Eggs", "Honey", "Larves", "Nectar", "Other", "Pollen"]
	number, // x
	number, // y
	number, // radius
	number // probability
]

export type CutPosition = {
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
			logger.info(`downloading ${file.url} -> ${file.localFilePath}`);
			await downloadFile(file.url, file.localFilePath);
			logger.info(`download complete ${file.url} -> ${file.localFilePath}`);
		}

		logger.info(`updating DB to start detection for fileid ${file.file_id}`);
		await fileModel.startDetection(file.file_id, file.frame_side_id);

		if (file.width === null || file.height === null) {
			const image = await Jimp.read(file.localFilePath)
			file.width = image.bitmap.width;
			file.height = image.bitmap.height;

			logger.info(`updating DB of file dimensions ${file.file_id}`);
			await fileModel.updateDimentions({
				width: file.width,
				height: file.height,
			}, file.file_id);
		}

		logger.info(`making parallel requests to detect objects for file ${file.file_id}`);
		await Promise.all([
			detectBees(file),
			detectFrameResources(file),
			detectQueenCups(file)
		])

		logger.info(`detections complete for ${file.file_id}`);
		await fileModel.endDetection(file.file_id, file.frame_side_id);
		fs.unlinkSync(file.localFilePath);
	}
	catch (e) {
		logger.error(e)
	}

	setTimeout(analyzeImage, 500);
}

export default function init() {
	analyzeImage();
};

export function roundToDecimal(num: number, decimalPlaces: number): number {
	const multiplier = Math.pow(10, decimalPlaces);
	return Math.round(num * multiplier) / multiplier;
}
