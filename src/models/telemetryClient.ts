import { logger } from '../logger';
import config from '../config';

export async function sendPopulationMetrics(
    hiveId: string,
    beeCount: number,
    droneCount: number,
    varroaMiteCount: number,
    inspectionId?: string
): Promise<void> {
    const mutation = `
        mutation AddPopulationMetric($hiveId: ID!, $fields: PopulationMetricInput!, $inspectionId: String) {
            addPopulationMetric(hiveId: $hiveId, fields: $fields, inspectionId: $inspectionId) {
                ... on AddMetricMessage {
                    message
                }
                ... on TelemetryError {
                    message
                    code
                }
            }
        }
    `;

    const variables = {
        hiveId,
        fields: {
            beeCount,
            droneCount,
            varroaMiteCount
        },
        inspectionId
    };

    try {
        const response = await fetch(config.telemetry_api_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: mutation,
                variables
            })
        });

        const result = await response.json();

        if (result.errors) {
            logger.error('Failed to send population metrics to telemetry-api', {
                errors: result.errors,
                hiveId,
                inspectionId
            });
            return;
        }

        if (result.data?.addPopulationMetric?.message === 'OK') {
            logger.info('Population metrics sent to telemetry-api', {
                hiveId,
                inspectionId,
                beeCount,
                droneCount,
                varroaMiteCount
            });
        } else {
            logger.error('Unexpected response from telemetry-api', {
                message: result.data?.addPopulationMetric?.message,
                hasData: !!result.data,
                hasErrors: !!result.errors,
                hiveId,
                inspectionId
            });
        }
    } catch (error) {
        logger.error('Error sending population metrics to telemetry-api', {
            error,
            hiveId,
            inspectionId
        });
    }
}

