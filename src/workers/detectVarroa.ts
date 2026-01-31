const { ClarifaiStub, grpc } = require("clarifai-nodejs-grpc");

import config from '../config';
import { logger } from '../logger';
import frameSideModel, { CutPosition, DetectedObject } from '../models/frameSide';

import { generateChannelName, publisher } from '../redisPubSub';

// Import common functions
import { transformSubImageCoordsToOriginal, retryAsyncFunction, roundToDecimal, splitIn9ImagesAndDetect } from './common/common'; // Updated import name
import { downloadS3FileToLocalTmp } from "./common/downloadFile";

// Define getVarroaKey locally using rounding
const getVarroaKey = (varroa: { x: number; y: number; w: number }) => {
    const x = varroa.x.toFixed(4);
    const y = varroa.y.toFixed(4);
    const w = varroa.w.toFixed(4);
    return `${x}-${y}-${w}`;
};


const PAT = config.clarifai.varroa_app.PAT;
const USER_ID = 'artjom-clarify';
const APP_ID = 'varroa-mites';
// Change these to whatever model and image URL you want to use
const MODEL_ID = 'varroa-mites';
export const MIN_VARROA_CONFIDENCE = 0.65;

const grpcClient = ClarifaiStub.grpc();

// This will be used by every Clarifai endpoint call
const metadata = new grpc.Metadata();
metadata.set("authorization", "Key " + PAT);

export async function detectVarroa(ref_id, payload) {
	const file = await frameSideModel.getFrameSideByFileId(ref_id);

	if (file == null) {
		throw new Error(`File ${ref_id} not found`)
	}

	logger.info('AnalyzeBeesAndVarroa - processing file', file);
	await downloadS3FileToLocalTmp(file);

	logger.info(`Making parallel requests to detect objects for file ${file.file_id}`);

	const allDetectedVarroa: DetectedObject[] = [];

	// 1. Detect on all chunks and collect results
	// Updated handler signature to match common.ts: (bytes, pos, id, name)
	await splitIn9ImagesAndDetect(file, 512, async (chunkBytes: Buffer, cutPosition: CutPosition, fileId: number, filename: string) => {
		// Pass necessary info to the chunk analyzer
		const chunkVarroa = await analyzeVarroaChunk(chunkBytes, cutPosition, fileId, filename);
		if (chunkVarroa && chunkVarroa.length > 0) {
			allDetectedVarroa.push(...chunkVarroa);
		}
	});

	// 2. Deduplicate aggregated results
	const uniqueVarroaMap = new Map<string, DetectedObject>();
	allDetectedVarroa.forEach(mite => {
		uniqueVarroaMap.set(getVarroaKey(mite), mite); // Assumes getVarroaKey is available
	});
	const finalUniqueVarroa = Array.from(uniqueVarroaMap.values());
	const finalVarroaCount = finalUniqueVarroa.length;

	logger.info(`Finished processing all chunks for file ${file.file_id}. Found ${finalVarroaCount} unique varroa mites.`);
	logger.debug(`Final unique varroa before DB update: ${JSON.stringify(finalUniqueVarroa)}`); // Added log

	// 3. Update database once with final results
	await frameSideModel.updateDetectedVarroa(
		finalUniqueVarroa,
		file.file_id,
		file.frame_side_id,
		file.user_id
	);

	// 4. Publish one final event
	publisher().publish(
		generateChannelName(
			file.user_id, 'frame_side',
			file.frame_side_id, 'varroa_detected'
		),
		JSON.stringify({
			delta: finalUniqueVarroa, // Send the final deduplicated list
			isVarroaDetectionComplete: true,
			varroaCount: finalVarroaCount
		})
	);
	logger.debug('Published final varroa event payload:', { delta: finalUniqueVarroa, isVarroaDetectionComplete: true, varroaCount: finalVarroaCount }); // Added log
} // End of detectVarroa function

// Updated function signature: analyzes a chunk and returns results, doesn't publish/update DB
async function analyzeVarroaChunk(
	chunkBytes: Buffer,
	cutPosition: CutPosition,
	fileId: number,
	filename: string
): Promise<DetectedObject[]> {
	logger.debug(`analyzeVarroaChunk: Analyzing chunk for file ${fileId} at position ${cutPosition.x},${cutPosition.y}`);
	// Pass bytes directly to askClarifai
	const detectedVarroa = await retryAsyncFunction(() => askClarifai(chunkBytes, cutPosition, fileId, filename), 3);
	return detectedVarroa || []; // Return empty array if detection fails or returns null/undefined
}


async function askClarifai(
	chunkBytes: Buffer, // Accept bytes directly
	cutPosition: CutPosition,
	fileId: number,
	filename: string
): Promise<DetectedObject[]> {
	const result: DetectedObject[] = [];

	logger.info(`Asking clarifai to detect varroa on chunk for file ${fileId} (${filename}) at ${cutPosition.x},${cutPosition.y}`);
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
								// Use chunkBytes directly
								base64: chunkBytes,
								allow_duplicate_url: true // Consider if this is still needed/correct
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
					logger.error('varroa response', response)

					return reject(new Error("Post model outputs failed, status: " + response.status.description));
				}

				// Since we have one input, one output will exist here
				const output = response.outputs[0];
				const regions = output.data.regions

				for (let i = 0; i < regions.length; i++) {
					const c = regions[i].value; // confidence
					if (c > MIN_VARROA_CONFIDENCE) {
						// Use the renamed coordinate transformation function
						const transformedCoords = transformSubImageCoordsToOriginal(
							regions[i].region_info.bounding_box,
							cutPosition
						);

						if (transformedCoords) { // Check if transformation was successful
							result.push({
								n: '11', // Assuming '11' signifies varroa mite
								c: roundToDecimal(c, 2),
								...transformedCoords
							});
						} else {
							logger.warn(`askClarifai: Failed to transform coordinates for region in chunk ${cutPosition.x},${cutPosition.y}`, { region: regions[i], cutPosition });
						}
					}
				}
				logger.info(`Varroa result for chunk ${cutPosition.x},${cutPosition.y}: Found ${result.length} mites above threshold.`);
				logger.debug('Varroa result details:', result);
				resolve(result)
			}

		);
	})
}
