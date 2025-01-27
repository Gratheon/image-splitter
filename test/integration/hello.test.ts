import * as fs from "fs";
import {expect} from '@jest/globals';
import fetch from 'node-fetch';
import config from '../../src/config';

// port from docker-compose.test.yml
const URL = 'http://localhost:8800/graphql';

describe('POST /graphql', () => {
    beforeEach(() => {
    });

    it.skip('hello_image_splitter', async () => {
        // make POST request
        // Send a POST request to the API endpoint
        const response = await fetch(URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'internal-router-signature': 'test-signature',
            },
            body: JSON.stringify({
                query: '{ hello_image_splitter }',
                variables: '{}'
            })
        });

        // Check if the response was successful
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Parse the response data as JSON
        const result = await response.json();

        expect(result?.data).toEqual({
            hello_image_splitter: 'hi',
        });
    });


    it('uploadFrameSide', async () => {
        const filePath = './test/integration/fixture/IMG_4368.JPG';
        const fileBuffer = fs.readFileSync(filePath);
        const fileName = filePath.split('/').pop();

        const form = new FormData();
        form.append('operations', JSON.stringify({
            query: `
                mutation($file: Upload!) {
                    uploadFrameSide(file: $file) {
                        __typename
                        id
                        url
                    }
                }
            `,
            variables: { file: null }
        }));
        form.append('map', JSON.stringify({ "0": ["variables.file"] }));
        form.append('0', new Blob([fileBuffer]), fileName);

        const response = await fetch(URL, {
            method: 'POST',
            headers: {
                'internal-router-signature': config.routerSignature,
                'internal-userid' : '1',
            },
            body: form
        });

        console.log('Response:', response);
        expect(response.status).toBe(200);
        const result = await response.json();

        expect(result).toHaveProperty('data');
        expect(result.data).toHaveProperty('uploadFrameSide');
        expect(result.data.uploadFrameSide).toHaveProperty('id');
        expect(result.data.uploadFrameSide).toHaveProperty('url');
    });
});