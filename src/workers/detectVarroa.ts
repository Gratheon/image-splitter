import jobs, {TYPE_QUEENS, TYPE_VARROA} from "../models/jobs";

const { ClarifaiStub, grpc } = require("clarifai-nodejs-grpc");

import config from '../config';
import { logger } from '../logger';
import frameSideModel, { CutPosition, DetectedObject } from '../models/frameSide';

import fileSideQueenCupsModel from '../models/frameSideQueenCups';
import { generateChannelName, publisher } from '../redisPubSub';

import { convertClarifaiCoords, retryAsyncFunction, roundToDecimal } from './common';

const PAT = config.clarifai.PAT;
const USER_ID = 'artjom-clarify';
const APP_ID = 'varroa-mites';
// Change these to whatever model and image URL you want to use
const MODEL_ID = 'varroa-mites';
export const MIN_VARROA_CONFIDENCE = 0.65;

const grpcClient = ClarifaiStub.grpc();

// This will be used by every Clarifai endpoint call
const metadata = new grpc.Metadata();
metadata.set("authorization", "Key " + PAT);

export async function analyzeAndUpdateVarroa(file, cutPosition: CutPosition) {
	await jobs.startDetection(TYPE_VARROA, file.id);

	const detectedVarroa = await retryAsyncFunction(() => askClarifai(file, cutPosition), 10)

	await frameSideModel.updateDetectedVarroa(
		detectedVarroa,
		file.file_id,
		file.frame_side_id,
		file.user_id
	);

	await jobs.endDetection(TYPE_VARROA, file.id);

	publisher().publish(
		generateChannelName(
			file.user_id, 'frame_side',
			file.frame_side_id, 'varroa_detected'
		),
		JSON.stringify({
			delta: detectedVarroa,
			isQueenCupsDetectionComplete: true
		})
	);
}

async function askClarifai(file, cutPosition: CutPosition) {
	const result: DetectedObject[] = [];

	const url = file.url
	logger.info("Asking clarifai to detect varroa on URL:" + url)
	return new Promise((resolve, reject) => {
		grpcClient.PostModelOutputs(
			{
				user_app_id: {
					"user_id": USER_ID,
					"app_id": APP_ID
				},
				model_id: MODEL_ID,
				inputs: [
					{
						data: {
							image: {
								base64: file.imageBytes,
								allow_duplicate_url: true
							}
						}
					}
				]
			},
			metadata,
			(err, response) => {
				if (err) {
					return reject(new Error(err));
				}

				console.log('varroa response', response)
				if (response.status.code !== 10000) {
					return reject(new Error("Post model outputs failed, status: " + response.status.description));
				}

				// Since we have one input, one output will exist here
				const output = response.outputs[0];
				const regions = output.data.regions

				for (let i = 0; i < regions.length; i++) {
					const c = regions[i].value // confidence
					if (c > MIN_VARROA_CONFIDENCE) {
						result.push(
							{
								n: '11',
								c: roundToDecimal(c, 2),
								...convertClarifaiCoords(
									regions[i].region_info.bounding_box,
									cutPosition
								)
							}
						)
					}
				}
				logger.info('varroa result', result)
				resolve(result)
			}

		);
	})
}