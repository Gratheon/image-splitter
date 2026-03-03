jest.mock('../../src/models/storage', () => ({
    storage: jest.fn(),
}));

import fileModel from '../../src/models/file';
import { storage } from '../../src/models/storage';

describe('file model', () => {
    const mockQuery = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (storage as jest.Mock).mockReturnValue({ query: mockQuery });
    });

    test('getFileExtension handles normal and edge-case filenames', () => {
        expect(fileModel.getFileExtension('photo.JPG')).toBe('jpg');
        expect(fileModel.getFileExtension('archive.tar.gz')).toBe('gz');
        expect(fileModel.getFileExtension('no-extension')).toBe('');
        expect(fileModel.getFileExtension('')).toBe('');
    });

    test('getUrl builds v1 and v2 urls correctly', () => {
        expect(
            fileModel.getUrl({
                url_version: 1,
                user_id: 99,
                filename: 'legacy.jpg',
            })
        ).toContain('/99/legacy.jpg');

        expect(
            fileModel.getUrl({
                url_version: 2,
                user_id: 99,
                hash: 'abc123',
                ext: 'png',
            })
        ).toContain('/99/abc123/original.png');
    });

    test('getHiveStatistics combines frame-side and varroa-bottom counts', async () => {
        mockQuery
            .mockResolvedValueOnce([
                {
                    workerBeeCount: '10',
                    droneCount: '3',
                    queenCount: '1',
                    varroaCountFrames: '2',
                },
            ])
            .mockResolvedValueOnce([{ varroaCountBottom: '4' }]);

        const stats = await fileModel.getHiveStatistics(7, 1);

        expect(stats).toEqual({
            workerBeeCount: 14,
            droneCount: 3,
            varroaCount: 6,
        });
    });
});
