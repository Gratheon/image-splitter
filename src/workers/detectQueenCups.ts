const { ClarifaiStub, grpc } = require("clarifai-nodejs-grpc");

import config from '../config';
import { logger } from '../logger';
import fileModel from '../models/file';
import { generateChannelName, publisher } from '../redisPubSub';

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
    const detectionResult = await retryAsyncFunction(async () => {
        return await askClarifai(file)
    }, 20, 60)

    logger.info('Updating DB with found compact stats');
    await fileModel.updateDetectedQueenCups(
        detectionResult,
        file.file_id,
        file.frame_side_id
    );


    logger.info('Publishing queen cup detection results to redis:');
    console.log(detectionResult)

    publisher.publish(
        generateChannelName(
            file.user_id,
            'frame_side',
            file.frame_side_id,
            'queen_cups_detected'
        ),
        JSON.stringify({
            delta: detectionResult
        })
    );
}

export type DetectedRectangle = {
	n: String, // class
	// 10 - queen cup
	x: number
	y: number

	x2: number
	y2: number
	c: number // confidence
}

async function askClarifai(file) {
    const result: DetectedRectangle[] = [];

    const url = file.url
    logger.info("Asking clarifai to detect cups on URL:" + url)
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
                console.log('result', result)
                resolve(result)
            }

        );
    })
}

async function retryAsyncFunction(asyncFunction, maxRetries, delayBetweenRetries) {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            return await asyncFunction();
        } catch (error) {
            logger.warn(`Attempt ${retries + 1} failed`);
            logger.warn(error);
            retries++;
            if (retries < maxRetries) {
                await new Promise((resolve) => setTimeout(resolve, delayBetweenRetries));
            }
        }
    }
    throw new Error(`Exceeded maximum retries (${maxRetries}).`);
}