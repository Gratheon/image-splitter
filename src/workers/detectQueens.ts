const { ClarifaiStub, grpc } = require("clarifai-nodejs-grpc");

import config from '../config';
import { logger } from '../logger';

import { DetectedObject } from '../models/frameSide';
import fileSideQueenCupsModel from '../models/frameSideQueenCups';
import fileSideModel from '../models/frameSide';

import { generateChannelName, publisher } from '../redisPubSub';
import { convertClarifaiCoords, retryAsyncFunction, roundToDecimal } from './common';

const PAT = config.clarifai.PAT;
const USER_ID = 'artjom-clarify';
const APP_ID = 'bee-queen-detection';
const MODEL_ID = 'queen-bee';
const MIN_CONFIDENCE = 0.65;

const grpcClient = ClarifaiStub.grpc();

// This will be used by every Clarifai endpoint call
const metadata = new grpc.Metadata();
metadata.set("authorization", "Key " + PAT);

export async function analyzeQueens(file, cutPosition): Promise<DetectedObject[]> {
    await fileSideQueenCupsModel.startDetection(file.file_id, file.frame_side_id);

    const detectionResult = await retryAsyncFunction(() => askClarifai(file, cutPosition), 10)

    logger.info("Queen detection result:", detectionResult)

    await fileSideModel.updateQueens(
        detectionResult,
        file.frame_side_id,
        file.user_id
    );

    publisher().publish(
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

async function askClarifai(file, cutPosition): Promise<DetectedObject[]> {
    const result: DetectedObject[] = [];

    const url = file.url
    logger.info("Asking clarifai to detect cups on URL:", { url })
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

                if (response.status.code !== 10000) {
                    return reject(new Error("Post model outputs failed, status: " + response.status.description));
                }


                // log("queen detection response from clarifai", response)

                // Since we have one input, one output will exist here
                const output = response.outputs[0];

                // log('queen detection result from clarifai', output)
                const regions = output.data.regions

                for (let i = 0; i < regions.length; i++) {
                    const c = regions[i].value // confidence
                    if (c > MIN_CONFIDENCE) {
                        result.push({
                            n: '3',
                            c: roundToDecimal(c, 2),

                            ...convertClarifaiCoords(
                                regions[i].region_info.bounding_box,
                                cutPosition
                            )
                        })
                    }
                }

                // log('queen result', result)
                resolve(result)
            }

        );
    })
}