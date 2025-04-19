const { ClarifaiStub, grpc } = require("clarifai-nodejs-grpc");

import config from '../config';
import { logger } from '../logger';

import frameSideModel, {CutPosition, DetectedObject} from '../models/frameSide';
import fileSideModel, {FrameSideFetchedByFileId} from '../models/frameSide'; // Import type

import { generateChannelName, publisher } from '../redisPubSub';
// Update import name and add FrameSideFetchedByFileId type
import { transformSubImageCoordsToOriginal, retryAsyncFunction, roundToDecimal, splitIn9ImagesAndDetect } from './common/common';
import { downloadS3FileToLocalTmp } from "./common/downloadFile";

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
    // Update handler signature: (bytes, pos, id, name)
    await splitIn9ImagesAndDetect(file, 1024, async (chunkBytes: Buffer, cutPosition: CutPosition, fileId: number, filename: string) => {
        // Pass necessary info, including original file details needed by analyzeQueens
        await analyzeQueens(chunkBytes, cutPosition, file); // Pass original file for user_id/frame_side_id
    });
}

// Updated signature
export async function analyzeQueens(
    chunkBytes: Buffer,
    cutPosition: CutPosition,
    originalFile: FrameSideFetchedByFileId // Need original file info for DB update/publish
): Promise<DetectedObject[]> {
    // Pass bytes and position to Clarifai
    const detectionResult = await retryAsyncFunction(() => askClarifai(chunkBytes, cutPosition, originalFile.file_id, originalFile.filename), 3);

    // Filter out null results from failed coordinate transformations
    const validDetections = detectionResult ? detectionResult.filter(d => d !== null) as DetectedObject[] : [];

    logger.info(`Queen detection result for chunk ${cutPosition.x},${cutPosition.y}:`, validDetections);

    // Use original file info for context
    await fileSideModel.updateQueens(
        validDetections,
        originalFile.frame_side_id,
        originalFile.user_id
    );

    // Publish only valid detections
    publisher().publish(
        generateChannelName(
            originalFile.user_id, 'frame_side',
            originalFile.frame_side_id, 'queens_detected'
        ),
        JSON.stringify({
            delta: validDetections, // Publish valid detections
            isQueenDetectionComplete: true // This might be premature if called per chunk? Revisit logic if needed.
        })
    );

    return validDetections; // Return only valid detections
}

// Updated signature
async function askClarifai(
    chunkBytes: Buffer,
    cutPosition: CutPosition,
    fileId: number,
    filename: string
): Promise<(DetectedObject | null)[]> { // Return array that might contain nulls
    const result: (DetectedObject | null)[] = []; // Allow nulls initially

    logger.info(`Asking clarifai to detect queen on chunk for file ${fileId} (${filename}) at ${cutPosition.x},${cutPosition.y}`);
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
                                base64: chunkBytes, // Use passed chunkBytes
                                allow_duplicate_url: true
                            }
                        }
                    }
                ]
            },
            metadata,
            (err, response) => {
                if (err) {
                    logger.error(`gRPC error calling PostModelOutputs for queen detection on file ${fileId}, chunk ${cutPosition.x},${cutPosition.y}`, err);
                    return reject(err); // Reject with the original error
                }

                if (response.status.code !== 10000) {
                    logger.error(`Clarifai API error for queen detection on file ${fileId}, chunk ${cutPosition.x},${cutPosition.y}. Status: ${response.status.description}`, { responseStatus: response.status });
                    return reject(new Error(`Post model outputs failed, status: ${response.status.code} - ${response.status.description}`));
                }

                // log("queen detection response from clarifai", response)

                // Since we have one input, one output will exist here
                const output = response.outputs[0];

                // log('queen detection result from clarifai', output)
                const regions = output.data.regions

                for (let i = 0; i < regions.length; i++) {
                    const c = regions[i].value; // confidence
                    if (c > MIN_CONFIDENCE) {
                        // Use the renamed coordinate transformation function
                        const transformedCoords = transformSubImageCoordsToOriginal(
                            regions[i].region_info.bounding_box,
                            cutPosition
                        );

                        if (transformedCoords) { // Check if transformation was successful
                            result.push({
                                n: '3', // Assuming '3' signifies queen
                                c: roundToDecimal(c, 2),
                                ...transformedCoords
                            });
                        } else {
                            logger.warn(`askClarifai (queen): Failed to transform coordinates for region in chunk ${cutPosition.x},${cutPosition.y}`, { region: regions[i], cutPosition });
                            result.push(null); // Add null placeholder if coords fail
                        }
                    }
                }
                logger.info(`Queen result for chunk ${cutPosition.x},${cutPosition.y}: Found ${result.filter(r => r !== null).length} potential queens above threshold.`);
                logger.debug('Queen result details (including nulls):', result);
                resolve(result)
            }

        );
    })
}
