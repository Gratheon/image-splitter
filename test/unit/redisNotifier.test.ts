jest.mock('../../src/redisPubSub', () => ({
    publisher: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
    logger: {
        error: jest.fn(),
        info: jest.fn(),
    },
}));

import notifyViaRedis from '../../src/workers/redisNotifier';
import { publisher } from '../../src/redisPubSub';
import { logger } from '../../src/logger';

describe('notifyViaRedis', () => {
    const mockPublish = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (publisher as jest.Mock).mockReturnValue({ publish: mockPublish });
    });

    test('logs error and skips publish when payload is missing', async () => {
        await notifyViaRedis(123, { redisChannelName: 'jobs:done' });

        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(mockPublish).not.toHaveBeenCalled();
    });

    test('publishes serialized payload to target channel', async () => {
        await notifyViaRedis(123, {
            redisChannelName: 'jobs:done',
            payload: { fileId: 55, ok: true },
        });

        expect(mockPublish).toHaveBeenCalledWith('jobs:done', JSON.stringify({ fileId: 55, ok: true }));
    });
});
