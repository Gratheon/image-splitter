import fs from 'fs';
import axios from "axios";

import { logger } from '../logger';
import config from '../config';

import { CutPosition, DetectedObject } from '../models/frameSide';
import { roundToDecimal } from './detectCells';

export async function detectVarroa(partialFilePath, cutPosition: CutPosition, splitCountX, splitCountY): Promise<DetectedObject[]> {
	logger.info('Making request to roboflow to detect varroa');
	const image = fs.readFileSync(partialFilePath, {
		encoding: "base64"
	});

	const rawResult = await axios({
		method: "POST",
		url: "https://detect.roboflow.com/varroa-gasbl/1",
		params: {
			api_key: config.roboflow.token
		},
		data: image,
		headers: {
			"Content-Type": "application/x-www-form-urlencoded"
		}
	});

	logger.info('Converting JSON to more compact format');
	const result: DetectedObject[] = [];

	for (let row of rawResult.data.predictions) {
		result.push({
			n: '11',
			x: roundToDecimal((Number(row.x) + cutPosition.left) / (splitCountX * cutPosition.width), 5),
			y: roundToDecimal((Number(row.y) + cutPosition.top) / (splitCountY * cutPosition.height), 5),
			w: roundToDecimal(Number(row.width) / (3 * cutPosition.width), 4),
			h: roundToDecimal(Number(row.height) / (3 * cutPosition.height), 4),
			c: roundToDecimal(row.confidence, 4)
		});
	}

	return result;

}
