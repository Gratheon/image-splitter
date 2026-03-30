import Redis from 'ioredis';

jest.mock('../../../src/models/frameSide', () => ({
  __esModule: true,
  default: {
    getFrameSideByFileId: jest.fn(),
    getDetectedBees: jest.fn(),
    updateDetectedVarroa: jest.fn(),
  },
}));

jest.mock('../../../src/models/storage', () => ({
  storage: jest.fn(() => ({ query: jest.fn() })),
}));

jest.mock('../../../src/workers/common/downloadFile', () => ({
  downloadS3FileToLocalTmp: jest.fn(),
}));

import frameSideModel from '../../../src/models/frameSide';
import { detectVarroa } from '../../../src/workers/detectVarroa';

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

describe('detectVarroa Redis integration', () => {
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

  it('publishes zero varroa result when no bee detections exist', async () => {
    const mockFile = {
      file_id: 901,
      frame_side_id: 701,
      user_id: 501,
      width: 2000,
      height: 1500,
      localFilePath: '/tmp/non-existent.jpg',
    };

    (frameSideModel.getFrameSideByFileId as jest.Mock).mockResolvedValue(mockFile);
    (frameSideModel.getDetectedBees as jest.Mock).mockResolvedValue([]);
    (frameSideModel.updateDetectedVarroa as jest.Mock).mockResolvedValue(undefined);

    const channel = `${mockFile.user_id}.frame_side.${mockFile.frame_side_id}.varroa_detected`;
    await redisClient.subscribe(channel);

    const messagePromise = waitForMessage(redisClient, channel);

    await detectVarroa(mockFile.file_id, {
      detectionThresholds: { varroa: 0.9 },
    });

    const message = await messagePromise;

    expect(frameSideModel.updateDetectedVarroa).toHaveBeenCalledWith(
      [],
      mockFile.file_id,
      mockFile.frame_side_id,
      mockFile.user_id,
    );

    expect(JSON.parse(message)).toEqual({
      delta: [],
      isVarroaDetectionComplete: true,
      varroaCount: 0,
    });

    await redisClient.unsubscribe(channel);
  });
});
