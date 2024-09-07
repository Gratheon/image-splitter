import fetch from 'node-fetch';
import { sql } from "@databases/mysql";

import { storage } from "./storage";
import config from '../config/index'
import {logger} from "../logger";


export default {
    generatePrompt: function (langCode, generateHiveAdvice) {
        // TODO add surrounding environment, plants
        // TODO add previous inspection history
        // TODO add weather
        // TODO add previous treatments
        // TODO add temperature and treatment of the hive once we have this data

        const months = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];

        const currentTimestamp = new Date();
        const day = currentTimestamp.getDate();
        const month = months[currentTimestamp.getMonth()];

        let RAW_TEXT = `Act as an expert beekeeper and provide detailed insights about beehive.
    Current date, which is ${day} ${month}.
    Take into consideration the following hive parameters given as a context in JSON format:

    ${JSON.stringify(generateHiveAdvice)}

    Provide a comprehensive analysis of the beehive's state and give recommendations for potential actions or interventions to optimize bee health, honey production, or address any issues. 
    Given a language code: ${langCode}, answer only in this language.

    Avoid explaining current context (like hive structure), user is already aware of it.
    Avoid referencing technical programming data (JSON keys, IDs, types)
    Avoid linebreack characters - return response in html format, use paragraphs tags, lists tags, avoid javascript and css. 
    `
        // Number of bees in the hive: 20000
        // Queen bee's status: missing
        // Queen cups: 4 detected
        // Hive has 2 sections
        // Section 1 (starting from bottom) has 8 frames
        // Section 2 (starting from bottom) has 8 frames
        // Brood per box, per frame:
        //     10% 20% 0% 0%  0% 20% 20% 0%
        //     0% 0% 0% 0%  0% 0% 0% 0%

        // Honey stores per box per frame:
        //     5% 2% 1% 10%  10% 0% 0% 0%
        //     0% 0% 0% 0% 0% 0% 0%

        // Pollen reserves per box per frame:
        //     5% 2% 1% 10%  10% 0% 0% 0%
        //     0% 0% 0% 0% 0% 0% 0%

        return RAW_TEXT;
    },

    insert: async function (user_id, hive_id, question, answer) {
        // @ts-ignore
        return (await storage().query(sql`
    INSERT INTO hive_advice (user_id, hive_id, question, answer) 
    VALUES (${user_id}, ${hive_id}, ${question}, ${answer});
    SELECT LAST_INSERT_ID() as id;
    `))[0].id;
    },


    getAdvice: async function (id, uid) {
        // @ts-ignore
        const result = (await storage().query(sql`
            SELECT answer
            FROM hive_advice
            WHERE hive_id=${id} and user_id=${uid}
            ORDER BY added_time DESC
            LIMIT 1`
        ));

        if (!result[0]) {
            return null
        }

        return result[0].answer
    },

    generateHiveAdvice: async function (prompt: string) {
        try {

            const PAT = config.clarifai.beekeeper_app.PAT;
            const USER_ID = config.clarifai.beekeeper_app.USER_ID;
            const APP_ID = config.clarifai.beekeeper_app.APP_ID;
            const MODEL_ID = config.clarifai.beekeeper_app.MODEL_ID;


            // for (let msg of data.repository.pullRequest.commits.edges[0].node.commit.tree.entries) {
            //     if (msg.object?.text) {
            //         RAW_TEXT += `\nFile "${msg.path}" contents: \n\n ${msg.object.text.substring(0, 10000)}`
            //     }
            // }

            const raw = JSON.stringify({
                "user_app_id": {
                    "user_id": USER_ID,
                    "app_id": APP_ID
                },
                "inputs": [
                    {
                        "data": {
                            "text": {
                                "raw": prompt
                            }
                        }
                    }
                ]
            });

            const requestOptions = {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Authorization': 'Key ' + PAT
                },
                body: raw
            };

            const response = await fetch("https://api.clarifai.com/v2/models/" + MODEL_ID + "/outputs", requestOptions)
            let clarifaiData = await response.json()

            if (clarifaiData?.status?.code != 10000) {
                logger.error("Unexpected response code", clarifaiData.status);
                return
            }

            logger.debug("clarifai response", clarifaiData)
            const clarifaiResponse = clarifaiData['outputs'][0]['data']['text']['raw']

            return clarifaiResponse

        } catch (error) {
            logger.error(error)
        }
    }
}