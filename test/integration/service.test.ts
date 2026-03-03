import { describe, expect, it } from '@jest/globals';

const baseUrl = 'http://localhost:8800';
const graphQlUrl = `${baseUrl}/graphql`;

describe('service endpoints', () => {
    it('returns health status', async () => {
        const response = await fetch(`${baseUrl}/healthz`);
        expect(response.status).toBe(200);

        const body = await response.json();
        expect(body).toHaveProperty('status', 'ok');
        expect(body).toHaveProperty('mysql');
    });

    it('returns job stats', async () => {
        const response = await fetch(`${baseUrl}/jobs/stats`);
        expect(response.status).toBe(200);

        const body = await response.json();
        expect(body).toHaveProperty('status', 'ok');
        expect(body).toHaveProperty('jobs');
        expect(body.jobs).toHaveProperty('bees');
        expect(body.jobs).toHaveProperty('varroa_bottom');
    });
});

describe('graphql unauthenticated fallbacks', () => {
    it('returns empty frameSidesInspections when no uid is provided', async () => {
        const response = await fetch(graphQlUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: `
                  query {
                    frameSidesInspections(inspectionId: 1) {
                      frameSideId
                    }
                  }
                `,
            }),
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.data.frameSidesInspections).toEqual([]);
    });

    it('returns zero hive statistics when no uid is provided', async () => {
        const response = await fetch(graphQlUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: `
                  query {
                    hiveStatistics(hiveId: 1) {
                      workerBeeCount
                      droneCount
                      varroaCount
                    }
                  }
                `,
            }),
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.data.hiveStatistics).toEqual({
            workerBeeCount: 0,
            droneCount: 0,
            varroaCount: 0,
        });
    });
});
