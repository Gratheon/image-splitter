import config from '../config';
import fs from 'fs'; // Import fs
import {logger} from '../logger';

import {retryAsyncFunction} from './common/common';
import { downloadS3FileToLocalTmp } from './common/downloadFile'; // Import download function
import fileSideQueenCupsModel from '../models/frameSideQueenCups';

import {generateChannelName, publisher} from '../redisPubSub';
import {DetectedRectangle} from './types';

const {ClarifaiStub, grpc} = require("clarifai-nodejs-grpc");

const PAT = config.clarifai.cup_app.PAT;
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
    const detectionResult = await retryAsyncFunction(() => askClarifai(file), 3)

    // logger.info("Queen cups detection result:")
    // logger.info(detectionResult)

    await fileSideQueenCupsModel.updateDetectedQueenCups(
        detectionResult,
        file.file_id,
        file.frame_side_id
    );

    logger.info('Publishing queen cup detection results to redis:', detectionResult)

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

    logger.info("Reading image from local path:", file.localFilePath);

    try {
        const imageBuffer = fs.readFileSync(file.localFilePath);
        const base64ImageData = imageBuffer.toString('base64');
        logger.info(`Asking clarifai to detect cups using base64 data (length: ${base64ImageData.length})`); // Combined into one string

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
                        {data: {image: {base64: base64ImageData}}} // Use base64 instead of url
                    ]
                },
                metadata,
                (err, response) => {
                    if (err) {
                        return reject(new Error(err));
                    }

                    if (response.status.code !== 10000) {
                        // Log the detailed error from Clarifai if available
                        const errorDetails = response.status.details ? ` Details: ${response.status.details}` : '';
                        return reject(new Error(`Post model outputs failed, status: ${response.status.description}.${errorDetails}`));
                    }

                // Since we have one input, one output will exist here
                const output = response.outputs[0];

                // console.log('output',output)
                const regions = output.data.regions

                for (let i = 0; i < regions.length; i++) {
                    const c = regions[i].value // confidence
                    if (c > 0.5) {
                        const {top_row, left_col, bottom_row, right_col} = regions[i].region_info.bounding_box

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
        });
    } catch (error) { // Changed variable name back
        logger.error("Error reading file or processing image for Clarifai:", error);
        throw error; // Re-throw the error to be caught by retryAsyncFunction or caller
    }
}

export async function analyzeQueenCups(ref_id, payload) {
    const file = await fileSideQueenCupsModel.getQueenCupsByFileId(ref_id);

    if (file == null) {
        throw new Error(`Queen cups entry with file_id ${ref_id} not found`)
    }

    logger.info('starting analyzeQueenCups', {file});

    // Download the file locally first
    await downloadS3FileToLocalTmp(file);
    logger.info(`File downloaded to ${file.localFilePath}`);

    await detectQueenCups(file);

    // Clean up the temporary file (optional, but good practice)
    try {
        if (file.localFilePath) {
            fs.unlinkSync(file.localFilePath);
            logger.info(`Cleaned up temporary file: ${file.localFilePath}`);
        }
    } catch (cleanupError) {
        logger.error(`Error cleaning up temporary file ${file.localFilePath}:`, cleanupError);
    }
}
