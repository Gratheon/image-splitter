jest.mock('ioredis', () => {
  return jest.fn().mockImplementation((config) => ({
    config,
    subscribe: jest.fn(),
    on: jest.fn(),
    publish: jest.fn(),
  }));
});

describe('redisPubSub', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.ENV_ID;
  });

  test('memoizes subscriber and publisher instances', async () => {
    const mod = await import('../../src/redisPubSub');
    const Redis = (await import('ioredis')).default as unknown as jest.Mock;

    const s1 = mod.subscriber();
    const s2 = mod.subscriber();
    const p1 = mod.publisher();
    const p2 = mod.publisher();

    expect(s1).toBe(s2);
    expect(p1).toBe(p2);
    expect(Redis).toHaveBeenCalledTimes(2);
  });

  test('uses localhost host in prod and redis host otherwise', async () => {
    process.env.ENV_ID = 'prod';
    const prodMod = await import('../../src/redisPubSub');
    const Redis = (await import('ioredis')).default as unknown as jest.Mock;
    prodMod.subscriber();

    expect(Redis.mock.calls[0][0].host).toBe('127.0.0.1');

    jest.resetModules();
    jest.clearAllMocks();
    process.env.ENV_ID = 'dev';

    const devMod = await import('../../src/redisPubSub');
    const Redis2 = (await import('ioredis')).default as unknown as jest.Mock;
    devMod.publisher();

    expect(Redis2.mock.calls[0][0].host).toBe('redis');
  });

  test('builds redis channel names', async () => {
    const { generateChannelName } = await import('../../src/redisPubSub');
    expect(generateChannelName(12, 'jobs', 'done')).toBe('12.jobs.done');
    expect(generateChannelName('u1', 'single')).toBe('u1.single');
  });
});
