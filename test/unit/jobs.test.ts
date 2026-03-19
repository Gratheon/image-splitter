jest.mock('../../src/models/storage', () => ({
  storage: jest.fn(),
}));

jest.mock('../../src/redisPubSub', () => ({
  publisher: jest.fn(),
  subscriber: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    errorEnriched: jest.fn(),
  },
}));

import jobsModel from '../../src/models/jobs';
import { storage } from '../../src/models/storage';
import { publisher, subscriber } from '../../src/redisPubSub';
import { logger } from '../../src/logger';

describe('jobs model', () => {
  const mockQuery = jest.fn();
  const mockTxQuery = jest.fn();
  const mockPublish = jest.fn();
  const mockSubscribe = jest.fn();
  const mockOn = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    (storage as jest.Mock).mockReturnValue({
      query: mockQuery,
      tx: async (fn) => fn({ query: mockTxQuery }),
    });
    (publisher as jest.Mock).mockReturnValue({ publish: mockPublish });
    (subscriber as jest.Mock).mockReturnValue({ subscribe: mockSubscribe, on: mockOn });
  });

  test('addJob inserts and publishes notification', async () => {
    await jobsModel.addJob('bees', 123, { source: 'upload' }, 3);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith('jobs:new:bees', JSON.stringify({ refId: 123, priority: 3 }));
  });

  test('addJob falls back to legacy insert and continues when publish fails', async () => {
    mockQuery
      .mockRejectedValueOnce(new Error("Unknown column 'priority' in 'field list'"))
      .mockResolvedValueOnce(undefined);
    mockPublish.mockRejectedValueOnce(new Error('redis down'));

    await expect(jobsModel.addJob('cells', 7, { p: true }, 5)).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test('isComplete returns false when no row, true when process_end_time exists', async () => {
    mockQuery.mockResolvedValueOnce([]);
    expect(await jobsModel.isComplete('bees', 1)).toBe(false);

    mockQuery.mockResolvedValueOnce([{ process_end_time: null }]);
    expect(await jobsModel.isComplete('bees', 1)).toBe(false);

    mockQuery.mockResolvedValueOnce([{ process_end_time: new Date() }]);
    expect(await jobsModel.isComplete('bees', 1)).toBe(true);
  });

  test('processJobInLoop subscribes and wires notification handler', async () => {
    const checkSpy = jest.spyOn(jobsModel, 'checkAndProcessJob').mockResolvedValue(undefined);
    const fn = jest.fn();

    await jobsModel.processJobInLoop('bees', fn);

    expect(mockSubscribe).toHaveBeenCalledWith('jobs:new:bees');
    expect(checkSpy).toHaveBeenCalledWith('bees', fn, 0);
    expect(mockOn).toHaveBeenCalledWith('message', expect.any(Function));

    const onMessage = mockOn.mock.calls[0][1];
    await onMessage('jobs:new:bees', '{"refId":10}');
    expect(checkSpy).toHaveBeenCalledTimes(2);
  });

  test('checkAndProcessJob processes a fetched job and schedules next check', async () => {
    jest.useFakeTimers();
    const setImmediateSpy = jest.spyOn(global, 'setImmediate');

    mockTxQuery.mockResolvedValueOnce([{ id: 1, ref_id: 33, payload: { x: 1 }, priority: 5 }]);
    mockTxQuery.mockResolvedValueOnce(undefined);
    mockQuery.mockResolvedValueOnce(undefined);
    const fn = jest.fn().mockResolvedValue(undefined);

    await jobsModel.checkAndProcessJob('bees', fn, 0);

    expect(fn).toHaveBeenCalledWith(33, { x: 1 });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(setImmediateSpy).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  test('checkAndProcessJob fails job and schedules retry delay on processor error', async () => {
    const timeoutSpy = jest.spyOn(global, 'setTimeout');

    mockTxQuery.mockResolvedValueOnce([{ id: 2, ref_id: 77, payload: {}, priority: 5 }]);
    mockTxQuery.mockResolvedValueOnce(undefined);
    const fn = jest.fn().mockRejectedValue(new Error('worker failed'));

    await jobsModel.checkAndProcessJob('cells', fn, 0);

    expect(logger.errorEnriched).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
  });
});
