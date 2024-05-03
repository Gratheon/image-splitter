const { ClarifaiStub, grpc } = require("clarifai-nodejs-grpc");

import config from '../config';
import { log, logger } from '../logger';

import { DetectedObject } from '../models/frameSide';
import fileSideQueenCupsModel from '../models/frameSideQueenCups';
import fileSideModel from '../models/frameSide';

import { generateChannelName, publisher } from '../redisPubSub';
import { sleep } from './downloadFile';

const PAT = config.clarifai.PAT;
const USER_ID = 'artjom-clarify';
const APP_ID = 'bee-queen-detection';
// Change these to whatever model and image URL you want to use
const MODEL_ID = 'queen-bee';
const MODEL_VERSION_ID = 'e8278fe079cc4d6796c37cae43015bb3';
const MIN_CONFIDENCE = 0.5;

const grpcClient = ClarifaiStub.grpc();

// This will be used by every Clarifai endpoint call
const metadata = new grpc.Metadata();
metadata.set("authorization", "Key " + PAT);

export async function analyzeQueens(file) : Promise<DetectedObject[]>{
    await fileSideQueenCupsModel.startDetection(file.file_id, file.frame_side_id);

    const detectionResult = await retryAsyncFunction(() => askClarifai(file), 10)

    // log("Queen detection result:", detectionResult)

    await fileSideModel.updateQueens(
        detectionResult,
        file.frame_side_id,
        file.user_id
    );

    // await fileSideQueenCupsModel.endDetection(file.file_id, file.frame_side_id);

    // log("Publishing queens detection results to redis", detectionResult)

    publisher.publish(
        generateChannelName(
            file.user_id, 'frame_side',
            file.frame_side_id, 'queens_detected'
        ),
        JSON.stringify({
            delta: detectionResult,
            isQueenCupsDetectionComplete: true
        })
    );

    return detectionResult
}

async function askClarifai(file) {
    const result: DetectedObject[] = [];

    const url = file.url
    log("Asking clarifai to detect cups on URL:", {url})
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

                if (response.status.code !== 10000) {
                    return reject(new Error("Post model outputs failed, status: " + response.status.description));
                }


                // log("response", response)

                // Since we have one input, one output will exist here
                const output = response.outputs[0];

                // log('queen detection result from clarifai', output)
                const regions = output.data.regions

                for (let i = 0; i < regions.length; i++) {
                    const c = regions[i].value // confidence
                    if (c > MIN_CONFIDENCE) {
                        const { top_row, left_col, bottom_row, right_col } = regions[i].region_info.bounding_box

                        // const h = bottom_row - top_row;
                        // const w = right_col - left_col;
                        result.push({
                            n: '3',
                            y: top_row,
                            x: left_col,
                            h: bottom_row-top_row,
                            w: right_col-left_col,
                            // y2: bottom_row,
                            // x2: right_col,
                            c
                        })
                    }
                }

                // log('queen result', result)
                resolve(result)
            }

        );
    })
}

async function retryAsyncFunction(asyncFunction, maxRetries) {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            return await asyncFunction();
        } catch (error) {
            logger.warn(`Attempt ${retries + 1} failed`);
            logger.warn(error);
            retries++;
            if (retries < maxRetries) {
                await sleep(60)
            }
        }
    }
    throw new Error(`Exceeded maximum retries (${maxRetries}).`);
}