jest.mock('../../src/models/storage', () => ({
  storage: jest.fn(),
}));

jest.mock('../../src/models/file', () => ({
  __esModule: true,
  default: {
    getUrl: jest.fn(() => 'https://files.example/u/file.jpg'),
  },
}));

jest.mock('../../src/models/image', () => ({
  getOriginalFileLocalPath: jest.fn(() => '/tmp/local.jpg'),
}));

import frameSideQueenCupsModel from '../../src/models/frameSideQueenCups';
import { storage } from '../../src/models/storage';
import fileModel from '../../src/models/file';
import * as imageModel from '../../src/models/image';

describe('frameSideQueenCups model', () => {
  const mockQuery = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (storage as jest.Mock).mockReturnValue({ query: mockQuery });
    (fileModel.getUrl as jest.Mock).mockReturnValue('https://files.example/u/file.jpg');
    (imageModel.getOriginalFileLocalPath as jest.Mock).mockReturnValue('/tmp/local.jpg');
  });

  test('getQueenCupsByFileId returns null when no matching row', async () => {
    mockQuery.mockResolvedValue([]);
    await expect(frameSideQueenCupsModel.getQueenCupsByFileId('123')).resolves.toBeNull();
  });

  test('getQueenCupsByFileId enriches file with url and localFilePath', async () => {
    mockQuery.mockResolvedValue([
      {
        user_id: 10,
        file_id: 22,
        frame_side_id: 33,
        filename: 'img.jpg',
        width: 100,
        height: 200,
        hash: 'abc',
        url_version: 2,
        ext: 'jpg',
      },
    ]);

    const file = await frameSideQueenCupsModel.getQueenCupsByFileId('22');

    expect(fileModel.getUrl).toHaveBeenCalledTimes(1);
    expect(imageModel.getOriginalFileLocalPath).toHaveBeenCalledWith(10, 'img.jpg', 'abc');
    expect(file).toMatchObject({
      file_id: 22,
      url: 'https://files.example/u/file.jpg',
      localFilePath: '/tmp/local.jpg',
    });
  });

  test('updateDetectedQueenCups stores detections and returns true', async () => {
    mockQuery.mockResolvedValue(undefined);
    await expect(frameSideQueenCupsModel.updateDetectedQueenCups([{ x: 1 }], 7, 8)).resolves.toBe(true);
  });

  test('addFrameCups inserts if missing and returns true', async () => {
    mockQuery.mockResolvedValue(undefined);
    await expect(frameSideQueenCupsModel.addFrameCups(1, 2, 3)).resolves.toBe(true);
  });

  test('cloneFramesForInspection updates rows and returns true', async () => {
    mockQuery.mockResolvedValue(undefined);
    await expect(frameSideQueenCupsModel.cloneFramesForInspection([1, 2], 999, 44)).resolves.toBe(true);
  });
});
