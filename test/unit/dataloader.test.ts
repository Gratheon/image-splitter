jest.mock('../../src/models/storage', () => ({
    storage: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
    logger: {
        error: jest.fn(),
    },
}));

import { createLoaders } from '../../src/graphql/dataloader';
import { storage } from '../../src/models/storage';
import { logger } from '../../src/logger';

describe('FrameSideCells DataLoader', () => {
    const uid = 123;
    const mockQuery = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (storage as jest.Mock).mockReturnValue({ query: mockQuery });
    });

    test('batches and maps results by frame side id', async () => {
        mockQuery.mockResolvedValue([
            { frame_side_id: 2, brood: 10, capped_brood: 20, eggs: 30, pollen: 40, honey: 50 },
            { frame_side_id: 1, brood: 1, capped_brood: 2, eggs: 3, pollen: 4, honey: 5 },
        ]);

        const loaders = createLoaders(uid);
        const results = await Promise.all([
            loaders.frameSideCellsLoader.load('1'),
            loaders.frameSideCellsLoader.load('2'),
            loaders.frameSideCellsLoader.load('404'),
        ]);

        expect(mockQuery).toHaveBeenCalledTimes(1);
        expect(results[0]).toMatchObject({ id: '1', broodPercent: 1, honeyPercent: 5 });
        expect(results[1]).toMatchObject({ id: '2', broodPercent: 10, honeyPercent: 50 });
        expect(results[2]).toBeNull();
    });

    test('uses dataloader cache for duplicate keys in same request', async () => {
        mockQuery.mockResolvedValue([{ frame_side_id: 1, brood: 1, capped_brood: 2, eggs: 3, pollen: 4, honey: 5 }]);

        const loaders = createLoaders(uid);
        const first = await loaders.frameSideCellsLoader.load('1');
        const second = await loaders.frameSideCellsLoader.load('1');

        expect(mockQuery).toHaveBeenCalledTimes(1);
        expect(first).toBe(second);
    });

    test('returns nulls and logs error when query fails', async () => {
        mockQuery.mockRejectedValue(new Error('db down'));

        const loaders = createLoaders(uid);
        const results = await Promise.all([
            loaders.frameSideCellsLoader.load('1'),
            loaders.frameSideCellsLoader.load('2'),
        ]);

        expect(results).toEqual([null, null]);
        expect(logger.error).toHaveBeenCalledTimes(1);
    });
});
