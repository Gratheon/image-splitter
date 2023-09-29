const { ClarifaiStub, grpc } = require("clarifai-nodejs-grpc");

import config from '../config';
import { logger } from '../logger';
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
        await askClarifai(file)
    }, 20, 60)

    logger.info('Publishing queen cup detection results to redis');
    publisher.publish(
        generateChannelName(
            file.user_id,
            'frame_side',
            file.frame_side_id,
            'queen_cups_detected'
        ),
        JSON.stringify({
            detectionResult
        })
    );
}

async function askClarifai(file) {
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

                logger.info("Predicted concepts:");
                console.log(response);

                // for (const concept of output.data.concepts) {
                //     logger.info(concept.name + " " + concept.value);
                // }

                resolve(output)
            }

        );
    })

}

async function retryAsyncFunction(asyncFunction, maxRetries, delayBetweenRetries) {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            const result = await asyncFunction();
            return result; // Return the result if successful.
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