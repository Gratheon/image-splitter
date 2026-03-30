import Redis from 'ioredis';

jest.mock('node-fetch', () => jest.fn());

jest.mock('../../../src/models/frameSide', () => ({
  __esModule: true,
  default: {
    getFrameSideByFileId: jest.fn(),
    updateDetectedBees: jest.fn(),
    getWorkerBeeCount: jest.fn(),
    getDroneCount: jest.fn(),
    getQueenCount: jest.fn(),
  },
}));

jest.mock('../../../src/models/jobs', () => ({
  __esModule: true,
  TYPE_BEES: 'bees',
  NOTIFY_JOB: 'notify',
  default: {
    addJob: jest.fn(),
  },
}));

jest.mock('../../../src/workers/common/downloadFile', () => ({
  downloadS3FileToLocalTmp: jest.fn(),
}));

jest.mock('../../../src/workers/common/common', () => {
  const actual = jest.requireActual('../../../src/workers/common/common');
  return {
    ...actual,
    splitIn9ImagesAndDetect: jest.fn(),
  };
});

import fetch from 'node-fetch';
import frameSideModel from '../../../src/models/frameSide';
import jobs from '../../../src/models/jobs';
import { splitIn9ImagesAndDetect } from '../../../src/workers/common/common';
import { detectWorkerBees } from '../../../src/workers/detectBees';

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

describe('detectWorkerBees Redis integration', () => {
  const redisClient = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USERNAME || 'default',
    password: process.env.REDIS_PASSWORD || 'pass',
    db: 0,
  });

  afterAll(async () => {
    const { publisher, subscriber } = await import('../../../src/redisPubSub');
    publisher().disconnect();
    subscriber().disconnect();
    await redisClient.quit();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('publishes partial bee detections and enqueues final completion notify job', async () => {
    const mockFile = {
      file_id: 101,
      frame_side_id: 201,
      user_id: 301,
      width: 1000,
      height: 1000,
      filename: 'frame.jpg',
      localFilePath: '/tmp/frame.jpg',
    };

    (frameSideModel.getFrameSideByFileId as jest.Mock).mockResolvedValue(mockFile);
    (frameSideModel.updateDetectedBees as jest.Mock).mockResolvedValue(undefined);
    (frameSideModel.getWorkerBeeCount as jest.Mock).mockResolvedValue(12);
    (frameSideModel.getDroneCount as jest.Mock).mockResolvedValue(3);
    (frameSideModel.getQueenCount as jest.Mock).mockResolvedValue(1);

    (splitIn9ImagesAndDetect as jest.Mock).mockImplementation(async (_file, _chunkSize, callback) => {
      await callback(Buffer.from('chunk'), { x: 1, y: 1, left: 100, top: 50 }, mockFile.file_id, mockFile.filename);
    });

    (fetch as unknown as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        result: [
          { class_id: 0, class_name: 'worker', confidence: 0.88, box: [10, 20, 50, 60] },
          { class_id: 3, class_name: 'queen', confidence: 0.99, box: [100, 100, 140, 160] },
          { class_id: 1, class_name: 'drone', confidence: 0.2, box: [20, 20, 40, 40] },
        ],
      }),
    });

    const partialChannel = `${mockFile.user_id}.frame_side.${mockFile.frame_side_id}.bees_partially_detected`;
    await redisClient.subscribe(partialChannel);
    const messagePromise = waitForMessage(redisClient, partialChannel);

    await detectWorkerBees(mockFile.file_id, {
      detectionThresholds: { bees: 0.6 },
    });

    const message = JSON.parse(await messagePromise);

    expect(frameSideModel.updateDetectedBees).toHaveBeenCalledWith(
      [{ n: '0', x: 0.13, y: 0.09, w: 0.04, h: 0.04, c: 0.88 }],
      mockFile.file_id,
      mockFile.frame_side_id,
      mockFile.user_id,
    );

    expect(message).toEqual({
      delta: [{ n: '0', x: 0.13, y: 0.09, w: 0.04, h: 0.04, c: 0.88 }],
      detectedWorkerBeeCount: 12,
      detectedDroneCount: 3,
      detectedQueenCount: 1,
      isBeeDetectionComplete: false,
    });

    expect(jobs.addJob).toHaveBeenCalledWith(
      'notify',
      mockFile.file_id,
      {
        redisChannelName: `${mockFile.user_id}.frame_side.${mockFile.frame_side_id}.bees_detected`,
        payload: {
          detectedWorkerBeeCount: 12,
          detectedDroneCount: 3,
          detectedQueenCount: 1,
          isBeeDetectionComplete: true,
        },
      },
      1,
    );

    await redisClient.unsubscribe(partialChannel);
  });
});
