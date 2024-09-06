import {expect} from '@jest/globals';
import fetch from 'node-fetch';

// port from docker-compose.test.yml
const URL = 'http://localhost:8800/graphql';

describe('POST /graphql', () => {
    beforeEach(() => {
    });

    it('clientsModel.add() should fill internalCache', async () => {
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
});