const { ClarifaiStub, grpc } = require("clarifai-nodejs-grpc");

import config from '../config';
import { logger } from '../logger';

import frameSideModel, {CutPosition, DetectedObject} from '../models/frameSide';
import fileSideModel from '../models/frameSide';

import { generateChannelName, publisher } from '../redisPubSub';
import {convertClarifaiCoords, retryAsyncFunction, roundToDecimal, splitIn9ImagesAndDetect} from './common/common';
import {downloadS3FileToLocalTmp} from "./common/downloadFile";

const PAT = config.clarifai.queen_app.PAT;
const USER_ID = 'artjom-clarify';
const APP_ID = 'bee-queen-detection';
const MODEL_ID = 'queen-bee-v4';
const MIN_CONFIDENCE = 0.60;

const grpcClient = ClarifaiStub.grpc();

// This will be used by every Clarifai endpoint call
const metadata = new grpc.Metadata();
metadata.set("authorization", "Key " + PAT);

export async function detectQueens(ref_id, payload) {
    const file = await frameSideModel.getFrameSideByFileId(ref_id);

    if (file == null) {
        throw new Error(`frameSideModel.getFrameSideByFileId failed and did not find any file ${ref_id} not found`)
    }

    logger.info('AnalyzeBeesAndVarroa - processing file', file);
    await downloadS3FileToLocalTmp(file);

    logger.info(`Making parallel requests to detect objects for file ${file.file_id}`);
    await splitIn9ImagesAndDetect(file, 1024, async (file: any, cutPosition: CutPosition, formData: any)=>{
        await analyzeQueens(file, cutPosition)
    });
}

export async function analyzeQueens(file, cutPosition): Promise<DetectedObject[]> {
    const detectionResult = await retryAsyncFunction(() => askClarifai(file, cutPosition), 3)

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
            isQueenDetectionComplete: true
        })
    );

    return detectionResult
}

async function askClarifai(file, cutPosition): Promise<DetectedObject[]> {
    const result: DetectedObject[] = [];

    const url = file.url
    logger.info("Asking clarifai to detect queen URL:", { url })
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
                    logger.error(`gRPC error calling PostModelOutputs for frame_side_id: ${file.frame_side_id}`, err);
                    return reject(new Error(err));
                }

                if (response.status.code !== 10000) {
                    logger.error(`Clarifai API error for frame_side_id: ${file.frame_side_id}. Status: ${response.status.description}`, { responseStatus: response.status });
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
