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

	if (file) {
		logger.info('starting processing file');
		logger.info({file});

		if (!fs.existsSync(file.localFilePath)) {
			await downloadFile(file.url, file.localFilePath);
		}

		await fileModel.startDetection(file.file_id, file.frame_side_id);

		let width, height, partialFilePath;

		let results: DetectedObject[] = [];

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

				const cutPosition: CutPosition = {
					width,
					height,
					left: x * width,
					top: y * height
				};

				await sharp(file.localFilePath).extract(cutPosition).jpeg({ mozjpeg: true }).toFile(partialFilePath)

				logger.info(`analyzing file id ${file.file_id}, frameside ${file.frame_side_id} at ${x}x${y}`);
				try {
					await (new Promise((resolve, reject) => {
						exec(`python3 detect.py --weights weights/bees.pt --device cpu --source ${partialFilePath} --save-txt --save-conf`,
							{
								cwd: '/app/models-yolov5'
							}, function (error, stdout, stderr) {
								if (error) {
									reject(stderr)
								} else {
									resolve(stdout)
								}
							})
					}));

					results =  [
						...results,
						...parseYoloText(fs.readFileSync('/app/models-yolov5/runs/detect/exp/result.txt', { encoding: 'utf8', flag: 'r' }), cutPosition)
					]
					
					console.log('results ', results);

					await (new Promise((resolve, reject) => {
						exec(`rm -rf runs`,
							{
								cwd: '/app/models-yolov5'
							}, function (error, stdout, stderr) {
								if (error) {
									reject(stderr)
								} else {
									resolve(stdout)
								}
							})
					}));

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

	setTimeout(getImageAndAddYoloAnnotations, 10000);
}


export default function init() {
	getImageAndAddYoloAnnotations();
};

export function parseYoloText(txt: string, cutPosition: CutPosition): DetectedObject[]{

	const result:DetectedObject[] = [];
	const lines = txt.split("\n");

	for(let line of lines){
		if(line.length<5) continue;

		const [n, x, y, w, h, c] = line.split(' ');
		console.log({cutPosition, line});
		result.push({
			n,
			x: roundToDecimal((Number(x)*cutPosition.width + cutPosition.left) / (3*cutPosition.width),5),
			y: roundToDecimal((Number(y)*cutPosition.height + cutPosition.top) / (3*cutPosition.height),5),
			w: roundToDecimal(Number(w)/3,4),
			h: roundToDecimal(Number(h)/3,4),
			c: roundToDecimal(Number(c),2)
		})
	}

	return result;
}

function roundToDecimal(num: number, decimalPlaces: number): number {
    const multiplier = Math.pow(10, decimalPlaces);
    return Math.round(num * multiplier) / multiplier;
}