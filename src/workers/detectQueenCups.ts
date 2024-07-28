const { ClarifaiStub, grpc } = require("clarifai-nodejs-grpc");

import config from '../config';
import { logger } from '../logger';

import { retryAsyncFunction } from './common';
import fileSideQueenCupsModel from '../models/frameSideQueenCups';

import { generateChannelName, publisher } from '../redisPubSub';
import { DetectedRectangle } from './types';
import { log } from 'console';

const PAT = config.clarifai.PAT;
const USER_ID = 'artjom-clarify';
const APP_ID = 'bee-queen-cup-detection';
// Change these to whatever model and image URL you want to use
const MODEL_ID = 'bee-queen-cup-detection';
const MODEL_VERSION_ID = '0f014801216346369d3543f6db831c84';

const grpcClient = ClarifaiStub.grpc();

// This will be used by every Clarifai endpoint call
const metadata = new grpc.Metadata();
metadata.set("authorization", "Key " + PAT);

export async function detectQueenCups(file) {
    await fileSideQueenCupsModel.startDetection(file.file_id, file.frame_side_id);

    const detectionResult = await retryAsyncFunction(() => askClarifai(file), 10)

    // logger.info("Queen cups detection result:")
    // logger.info(detectionResult)

    await fileSideQueenCupsModel.updateDetectedQueenCups(
        detectionResult,
        file.file_id,
        file.frame_side_id
    );

    await fileSideQueenCupsModel.endDetection(file.file_id, file.frame_side_id);

    log('Publishing queen cup detection results to redis:', detectionResult)

    publisher().publish(
        generateChannelName(
            file.user_id, 'frame_side',
            file.frame_side_id, 'queen_cups_detected'
        ),
        JSON.stringify({
            delta: detectionResult,
            isQueenCupsDetectionComplete: true
        })
    );
}

async function askClarifai(file) {
    const result: DetectedRectangle[] = [];

    const url = file.url
    log("Asking clarifai to detect cups on URL:", url)
    return new Promise((resolve, reject) => {
        grpcClient.PostModelOutputs(
            {
                user_app_id: {
                    "user_id": USER_ID,
                    "app_id": APP_ID
                },
                model_id: MODEL_ID,
                version_id: MODEL_VERSION_ID, // This is optional. Defaults to the latest model version
                inputs: [
                    { data: { image: { url, allow_duplicate_url: true } } }
                ]
            },
            metadata,
            (err, response) => {
                if (err) {
                    return reject(new Error(err));
                }

                if (response.status.code !== 10000) {
                    return reject(new Error("Post model outputs failed, status: " + response.status.description));
                }

                // Since we have one input, one output will exist here
                const output = response.outputs[0];

                // console.log('output',output)
                const regions = output.data.regions

                for (let i = 0; i < regions.length; i++) {
                    const c = regions[i].value // confidence
                    if (c > 0.5) {
                        const { top_row, left_col, bottom_row, right_col } = regions[i].region_info.bounding_box

                        // const h = bottom_row - top_row;
                        // const w = right_col - left_col;
                        result.push({
                            n: '10',
                            y: top_row,
                            x: left_col,
                            y2: bottom_row,
                            x2: right_col,
                            c
                        })
                    }
                }
                resolve(result)
            }

        );
    })
}

export async function analyzeQueenCups() {
	const file = await fileSideQueenCupsModel.getFirstUnprocessedCups();

	if (file == null) {
		setTimeout(analyzeQueenCups, 10000);
		return;
	}

	logger.info('starting processing file', { file });

	try {
		// no need to download file, clarifai will do it for us
		logger.info(`making parallel requests to detect queen cups for file ${file.file_id}`);
		await detectQueenCups(file);
	}
	catch (e) {
		logger.error(e);
	}

	setTimeout(analyzeQueenCups, 500);
}
