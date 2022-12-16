import sharp from 'sharp';
import fs from 'fs';
import https from 'https';
import { exec } from 'child_process';
import {logger} from '../logger';

import fileModel from '../models/file';

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

async function getImageAndAddYoloAnnotations() {
	const file = await fileModel.getFirstUnprocessedFile();

	if (file) {
		logger.info('starting processing file', file);

		if (!fs.existsSync(file.localFilePath)) {
			await downloadFile(file.url, file.localFilePath);
		}

		await fileModel.startDetection(file.file_id, file.frame_side_id);

		let width, height, partialFilePath;

		const results = {};

		if (file.width === null || file.height === null) {
			const image = await sharp(file.localFilePath)
			const metadata = await image.metadata()
			file.width = metadata.width;
			file.height = metadata.height;

			await fileModel.updateDimentions(metadata, file.file_id);
		}

		for (let x = 0; x < 3; x++) {
			for (let y = 0; y < 3; y++) {
				width = Math.floor(file.width / 3)
				height = Math.floor(file.height / 3)
				partialFilePath = `/app/tmp/${file.user_id}_${x}${y}_${file.filename}`;

				await sharp(file.localFilePath).extract({
					width,
					height,
					left: x * width,
					top: y * height
				}).jpeg({ mozjpeg: true }).toFile(partialFilePath)

				logger.info(`starting darknet on file ${file.id} frameside ${file.frame_side_id} at ${x}x${y}`);
				try {
					const resultTxt = await (new Promise((resolve, reject) => {
						exec(`/app/darknet/darknet detector test /app/darknet/cfg/coco.data /app/yolo-v3/model.cfg /app/yolo-v3/model.weights -i 0 -thresh 0.01 -ext_output -dont_show ${partialFilePath} -out /app/tmp/result.json`,
							{
								cwd: '/app/darknet/'
							}, function (error, stdout, stderr) {
								if (error) {
									reject(stderr)
								} else {
									resolve(stdout)
								}
							})
					}));
					results[`${x}${y}`] = JSON.parse(fs.readFileSync('/app/tmp/result.json', { encoding: 'utf8', flag: 'r' }));

					await fileModel.updateDetections(
						results,
						file.file_id,
						file.frame_side_id
					)

					fs.unlinkSync(partialFilePath);
				}
				catch (e) {
					console.error(e);
				}
			}
		}

		await fileModel.endDetection(file.file_id, file.frame_side_id);
		fs.unlinkSync(file.localFilePath);
	}

	setTimeout(getImageAndAddYoloAnnotations, 1000);
}


export default function init() {
	getImageAndAddYoloAnnotations();
};