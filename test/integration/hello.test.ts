import * as fs from "fs";
import {expect, describe, it, beforeEach} from '@jest/globals'; // Import Jest globals explicitly
// Use global fetch, FormData, Blob instead of node-fetch and form-data packages
import jwt from 'jsonwebtoken'; // Import jsonwebtoken
import config from '../../src/config';

// port from docker-compose.test.yml
const URL = 'http://localhost:8800/graphql';

describe('POST /graphql', () => {
    beforeEach(() => {
    });

    it('hello_image_splitter', async () => { // Remove .skip
        // make POST request
        // Send a POST request to the API endpoint
        const response = await fetch(URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'internal-router-signature': config.routerSignature, // Use config value for consistency
                'internal-userid': '1' // Add the user ID header
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
        const fileName = filePath.split('/').pop() || 'upload.jpg'; // Provide default filename

        const form = new FormData(); // Use global FormData
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
        // Use Blob with global FormData
        form.append('0', new Blob([fileBuffer]), fileName);

        // Generate JWT
        const payload = { user_id: '1' }; // Use the same user ID as internal-userid for consistency
        const token = jwt.sign(payload, config.jwt.privateKey);

        const response = await fetch(URL, {
            method: 'POST',
            headers: {
                // Keep existing headers if needed, but add the token
                'internal-router-signature': config.routerSignature,
                'internal-userid' : '1',
                'token': token // Add the JWT token header
                // Native fetch handles FormData headers automatically
            },
            body: form // Send the global FormData object
        });

        // Check status and log errors if not 200
        if (response.status !== 200) {
            try {
                const errorResult = await response.json();
                console.error('GraphQL Errors:', JSON.stringify(errorResult.errors, null, 2));
            } catch (e) {
                console.error('Failed to parse error response JSON:', e);
                console.error('Raw error response text:', await response.text());
            }
        }

        expect(response.status).toBe(200); // Keep the assertion

        // Proceed to parse and check data if status was 200
        const bodyText = await response.text(); // Consume body as text first
        const result = JSON.parse(bodyText); // Then parse the text

        expect(result).toHaveProperty('data');
        expect(result.data).toHaveProperty('uploadFrameSide');
        expect(result.data.uploadFrameSide).toHaveProperty('id');
        expect(result.data.uploadFrameSide).toHaveProperty('url');
    });
});
