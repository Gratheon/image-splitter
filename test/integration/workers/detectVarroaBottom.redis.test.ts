import Redis from 'ioredis';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

jest.mock('sharp', () => {
  return jest.fn(() => ({
    metadata: jest.fn().mockResolvedValue({ width: 100, height: 200 }),
  }));
});

jest.mock('../../../src/models/boxFile', () => ({
  __esModule: true,
  default: {
    getBoxFileByFileId: jest.fn(),
    updateVarroaDetections: jest.fn(),
  },
}));

jest.mock('../../../src/models/image', () => ({
  getOriginalFileLocalPath: jest.fn(() => '/tmp/box-file.jpg'),
}));

jest.mock('../../../src/workers/common/downloadFile', () => ({
  downloadS3FileToLocalTmp: jest.fn(),
}));

import axios from 'axios';
import fs from 'fs';
import boxFileModel from '../../../src/models/boxFile';
import { detectVarroaBottom } from '../../../src/workers/detectVarroaBottom';

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

describe('detectVarroaBottom Redis integration', () => {
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

    jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('image-bytes') as any);
    jest.spyOn(fs, 'statSync').mockReturnValue({ size: 2048 } as any);
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'unlinkSync').mockReturnValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('publishes normalized detections and writes DB update', async () => {
    const mockBoxFile = {
      box_id: 77,
      user_id: 55,
      file_user_id: 55,
      hash: 'abc123',
      filename: 'bottom.jpg',
      url: 'https://example.test/bottom.jpg',
    };

    (boxFileModel.getBoxFileByFileId as jest.Mock).mockResolvedValue(mockBoxFile);
    (boxFileModel.updateVarroaDetections as jest.Mock).mockResolvedValue(undefined);

    (axios.post as jest.Mock).mockResolvedValue({
      data: {
        message: 'ok',
        result: [
          { x1: 10, y1: 20, x2: 30, y2: 60, confidence: 0.9 },
          { x1: 50, y1: 50, x2: 100, y2: 100, confidence: 0.4 },
        ],
      },
    });

    const fileId = 999;
    const channel = `${mockBoxFile.user_id}.box.${mockBoxFile.box_id}.varroa_detected`;
    await redisClient.subscribe(channel);

    const messagePromise = waitForMessage(redisClient, channel);

    await detectVarroaBottom(fileId, {
      detectionThresholds: { varroaBottom: 0.5 },
    });

    const message = await messagePromise;

    expect(boxFileModel.updateVarroaDetections).toHaveBeenCalledWith(
      fileId,
      mockBoxFile.box_id,
      mockBoxFile.user_id,
      1,
      [{ x: 0.2, y: 0.2, w: 0.2, c: 0.9 }],
    );

    expect(JSON.parse(message)).toEqual({
      fileId,
      boxId: mockBoxFile.box_id,
      varroaCount: 1,
      detections: [{ x: 0.2, y: 0.2, w: 0.2, c: 0.9 }],
      isComplete: true,
    });

    expect(fs.unlinkSync).toHaveBeenCalled();

    await redisClient.unsubscribe(channel);
  });
});
