import Jimp from 'jimp';
import fs from 'fs';
import https from 'https';

import { logger } from '../logger';
import fileModel from '../models/file';
import frameSideModel from '../models/frameSide';

import { detectBees } from './detectBees';
import { detectCells } from './detectCells';
import { detectQueenCups } from './detectQueenCups';

import frameSideCells from '../models/frameSideCells';
import cupsModel from '../models/frameSideQueenCups';

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

export type DetectedFrameResource = [
	number, // class: ["Capped", "Eggs", "Honey", "Larves", "Nectar", "Other", "Pollen"]
	number, // x
	number, // y
	number, // radius
	number // probability
]

async function analyzeBees() {
	const file = await frameSideModel.getFirstUnprocessedBees();

	if (file == null) {
		setTimeout(analyzeBees, 10000);
		return
	}

	logger.info('starting processing file');
	logger.info({ file });

	try {
		await downloadAndUpdateResolutionInDB(file);

		logger.info(`making parallel requests to detect objects for file ${file.file_id}`);
		await detectBees(file)
		
		fs.unlinkSync(file.localFilePath);
	}
	catch (e) {
		logger.error(e)
	}

	setTimeout(analyzeBees, 500);
}

async function analyzeCells() {
	const file = await frameSideCells.getFirstUnprocessedCells();

	if (file == null) {
		setTimeout(analyzeCells, 10000);
		return
	}

	logger.info('starting processing file');
	logger.info({ file });

	try {
		await downloadAndUpdateResolutionInDB(file);

		logger.info(`making parallel requests to detect cells for file ${file.file_id}`);
		await detectCells(file)
		
		fs.unlinkSync(file.localFilePath);
	}
	catch (e) {
		logger.error(e)
	}

	setTimeout(analyzeCells, 500);
}

async function analyzeQueenCups() {
	const file = await cupsModel.getFirstUnprocessedCups();

	if (file == null) {
		setTimeout(analyzeQueenCups, 10000);
		return
	}

	logger.info('starting processing file');
	logger.info({ file });

	try {
		// no need to download file, clarifai will do it for us
		logger.info(`making parallel requests to detect queen cups for file ${file.file_id}`);
		await detectQueenCups(file)
	}
	catch (e) {
		logger.error(e)
	}

	setTimeout(analyzeQueenCups, 500);
}

async function downloadAndUpdateResolutionInDB(file: any) {
	if (!fs.existsSync(file.localFilePath)) {
		logger.info(`downloading ${file.url} -> ${file.localFilePath}`);
		await downloadFile(file.url, file.localFilePath);
		logger.info(`download complete ${file.url} -> ${file.localFilePath}`);
	}

	if (file.width === null || file.height === null) {
		const image = await Jimp.read(file.localFilePath);
		file.width = image.bitmap.width;
		file.height = image.bitmap.height;

		logger.info(`updating DB of file dimensions ${file.file_id}`);
		await fileModel.updateDimentions({
			width: file.width,
			height: file.height,
		}, file.file_id);
	}
}

export default function init() {
	analyzeBees();
	analyzeCells();
	analyzeQueenCups();
};