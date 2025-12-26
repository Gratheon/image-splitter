import { createLoaders } from '../src/graphql/dataloader';

describe('FrameSideCells DataLoader', () => {
    const mockUid = 123;

    test('should batch multiple load calls', async () => {
        const loaders = createLoaders(mockUid);

        const frameSideIds = ['1', '2', '3', '4', '5'];

        const promises = frameSideIds.map(id =>
            loaders.frameSideCellsLoader.load(id)
        );

        const results = await Promise.all(promises);

        expect(results).toHaveLength(5);
        expect(Array.isArray(results)).toBe(true);
    });

    test('should cache results within same request', async () => {
        const loaders = createLoaders(mockUid);

        const result1 = await loaders.frameSideCellsLoader.load('1');
        const result2 = await loaders.frameSideCellsLoader.load('1');

        expect(result1).toBe(result2);
    });

    test('should return null for non-existent frame sides', async () => {
        const loaders = createLoaders(mockUid);

        const result = await loaders.frameSideCellsLoader.load('999999');

        expect(result).toBeNull();
    });
});

