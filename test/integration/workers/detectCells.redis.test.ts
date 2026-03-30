import Redis from 'ioredis';
import fs from 'fs';

jest.mock('node-fetch', () => jest.fn());

jest.mock('../../../src/models/frameSideCells', () => ({
  __esModule: true,
  default: {
    getCellsByFileId: jest.fn(),
    updateDetectedCells: jest.fn(),
  },
}));

jest.mock('../../../src/models/jobs', () => ({
  __esModule: true,
  NOTIFY_JOB: 'notify',
  default: {
    addJob: jest.fn(),
  },
}));

jest.mock('../../../src/workers/common/downloadFile', () => ({
  downloadS3FileToLocalTmp: jest.fn(),
}));

import fetch from 'node-fetch';
import frameSideCells from '../../../src/models/frameSideCells';
import jobs from '../../../src/models/jobs';
import { analyzeCells } from '../../../src/workers/detectCells';

async function waitForMessage(redis: Redis, channel: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      redis.removeListener('message', onMessage);
      reject(new Error(`Timed out waiting for Redis message on ${channel}`));
    }, timeoutMs);

    const onMessage = (messageChannel: string, message: string) => {
      if (messageChannel !== channel) return;
      clearTimeout(timeout);
      redis.removeListener('message', onMessage);
      resolve(message);
    };

    redis.on('message', onMessage);
  });
}

describe('analyzeCells Redis integration', () => {
  const redisClient = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USERNAME || 'default',
    password: process.env.REDIS_PASSWORD || 'pass',
    db: 0,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('image-bytes') as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    const { publisher, subscriber } = await import('../../../src/redisPubSub');
    publisher().disconnect();
    subscriber().disconnect();
    await redisClient.quit();
  });

  it('publishes converted cells result and enqueues hive notify job', async () => {
    const mockFile = {
      file_id: 121,
      frame_side_id: 221,
      user_id: 321,
      hive_id: 421,
      width: 1000,
      height: 500,
      filename: 'cells.jpg',
      localFilePath: '/tmp/cells.jpg',
    };

    (frameSideCells.getCellsByFileId as jest.Mock).mockResolvedValue(mockFile);
    (frameSideCells.updateDetectedCells as jest.Mock).mockResolvedValue({
      brood: 10,
      drone_brood: 11,
      capped_brood: 12,
      eggs: 13,
      nectar: 14,
      pollen: 15,
      honey: 16,
    });

    (fetch as unknown as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        result: [
          [500, 250, 100, 2, 0, 0.913],
        ],
      }),
    });

    const channel = `${mockFile.user_id}.frame_side.${mockFile.frame_side_id}.frame_resources_detected`;
    await redisClient.subscribe(channel);
    const messagePromise = waitForMessage(redisClient, channel);

    await analyzeCells(mockFile.file_id, {});

    const message = JSON.parse(await messagePromise);

    expect(frameSideCells.updateDetectedCells).toHaveBeenCalledWith(
      [[2, 0.5, 0.5, 0.1, 92]],
      mockFile.file_id,
      mockFile.frame_side_id,
    );

    expect(message).toEqual({
      delta: [[2, 0.5, 0.5, 0.1, 92]],
      isCellsDetectionComplete: true,
      broodPercent: 10,
      droneBroodPercent: 11,
      cappedBroodPercent: 12,
      eggsPercent: 13,
      nectarPercent: 14,
      pollenPercent: 15,
      honeyPercent: 16,
    });

    expect(jobs.addJob).toHaveBeenCalledWith(
      'notify',
      mockFile.file_id,
      {
        redisChannelName: `${mockFile.user_id}.hive.${mockFile.hive_id}.frame_resources_detected`,
        payload: {
          delta: [[2, 0.5, 0.5, 0.1, 92]],
          isCellsDetectionComplete: true,
          frameSideId: mockFile.frame_side_id,
          broodPercent: 10,
          droneBroodPercent: 11,
          cappedBroodPercent: 12,
          eggsPercent: 13,
          nectarPercent: 14,
          pollenPercent: 15,
          honeyPercent: 16,
        },
      },
      1,
    );

    await redisClient.unsubscribe(channel);
  });
});
