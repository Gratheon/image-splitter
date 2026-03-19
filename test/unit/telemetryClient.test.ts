jest.mock('../../src/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/config', () => ({
  __esModule: true,
  default: {
    telemetry_api_url: 'https://telemetry.example/graphql',
  },
}));

import { sendPopulationMetrics } from '../../src/models/telemetryClient';
import { logger } from '../../src/logger';

describe('telemetryClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('logs success when telemetry-api returns OK', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      json: async () => ({ data: { addPopulationMetric: { message: 'OK' } } }),
    });

    await sendPopulationMetrics('h1', 10, 2, 1, 'insp-1');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('logs GraphQL errors from telemetry-api', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      json: async () => ({ errors: [{ message: 'boom' }] }),
    });

    await sendPopulationMetrics('h2', 20, 3, 2);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test('logs unexpected response shape', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      json: async () => ({ data: { addPopulationMetric: { message: 'NOPE' } } }),
    });

    await sendPopulationMetrics('h3', 30, 4, 3);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test('logs fetch exception', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('network fail'));

    await sendPopulationMetrics('h4', 40, 5, 4);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
