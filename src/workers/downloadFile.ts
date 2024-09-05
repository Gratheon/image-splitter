// @ts-ignore
import Jimp from 'jimp';
// @ts-ignore
import fs from 'fs';
// @ts-ignore
import https from 'https';

import { logger } from '../logger';
import fileModel from '../models/file';

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

export async function downloadAndUpdateResolutionInDB(file: any) {
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

export async function sleep(sec = 1) {
	// slow down API for security to slow down brute-force
	await new Promise(resolve => setTimeout(resolve, sec * 1000));
}

