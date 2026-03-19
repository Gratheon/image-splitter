jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
    unlinkSync: jest.fn(),
  },
}));

jest.mock('../../src/config', () => ({
  __esModule: true,
  default: {
    rootPath: '/app/',
  },
}));

jest.mock('../../src/models/image', () => ({
  getOriginalFileLocalPath: jest.fn(),
  resizeImages: jest.fn(),
}));

jest.mock('../../src/models/fileResize', () => ({
  __esModule: true,
  default: {
    insertResize: jest.fn(),
  },
}));

jest.mock('../../src/models/s3', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../../src/models/file', () => ({
  __esModule: true,
  default: {
    getById: jest.fn(),
    getUrl: jest.fn(),
  },
}));

jest.mock('../../src/workers/common/downloadFile', () => ({
  downloadS3FileToLocalTmp: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import fs from 'fs';
import resizeOriginalToThumbnails from '../../src/workers/common/resizeOriginalToThumbnails';
import * as imageModel from '../../src/models/image';
import fileResizeModel from '../../src/models/fileResize';
import upload from '../../src/models/s3';
import fileModel from '../../src/models/file';
import { downloadS3FileToLocalTmp } from '../../src/workers/common/downloadFile';
import { logger } from '../../src/logger';

describe('resizeOriginalToThumbnails worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (imageModel.getOriginalFileLocalPath as jest.Mock).mockReturnValue('/app/tmp/original.jpg');
    (fileModel.getUrl as jest.Mock).mockReturnValue('https://cdn.example/original.jpg');
  });

  test('throws when file metadata is missing', async () => {
    (fileModel.getById as jest.Mock).mockResolvedValue(null);

    await expect(
      resizeOriginalToThumbnails(5, { uid: '1', filename: 'a.jpg', hash: 'h', ext: 'jpg', file_id: '5' }),
    ).rejects.toThrow('File metadata not found');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test('throws when download fails', async () => {
    (fileModel.getById as jest.Mock).mockResolvedValue({
      filename: 'a.jpg',
      hash: 'h',
      width: 100,
      height: 80,
    });
    (downloadS3FileToLocalTmp as jest.Mock).mockRejectedValue(new Error('download failed'));

    await expect(
      resizeOriginalToThumbnails(6, { uid: '2', filename: 'a.jpg', hash: 'h', ext: 'jpg', file_id: '6' }),
    ).rejects.toThrow('download failed');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test('resizes, uploads, stores DB records and cleans up files', async () => {
    (fileModel.getById as jest.Mock).mockResolvedValue({
      filename: 'frame.jpg',
      hash: 'abc',
      width: 3000,
      height: 2000,
    });
    (downloadS3FileToLocalTmp as jest.Mock).mockResolvedValue(undefined);
    (imageModel.resizeImages as jest.Mock).mockResolvedValue([
      [1024, '/app/tmp/r1024.jpg'],
      [512, '/app/tmp/r512.jpg'],
      [128, '/app/tmp/r128.jpg'],
    ]);
    (upload as jest.Mock).mockResolvedValue(undefined);
    ((fileResizeModel as any).insertResize as jest.Mock).mockResolvedValue(undefined);
    ((fs as any).existsSync as jest.Mock).mockReturnValue(true);

    await resizeOriginalToThumbnails(7, {
      uid: '3',
      filename: 'frame.jpg',
      hash: 'abc',
      ext: 'jpg',
      file_id: '7',
    });

    expect(upload).toHaveBeenCalledTimes(3);
    expect((fileResizeModel as any).insertResize).toHaveBeenCalledTimes(3);
    expect((fs as any).unlinkSync).toHaveBeenCalledWith('/app/tmp/r1024.jpg');
    expect((fs as any).unlinkSync).toHaveBeenCalledWith('/app/tmp/r512.jpg');
    expect((fs as any).unlinkSync).toHaveBeenCalledWith('/app/tmp/r128.jpg');
    expect((fs as any).unlinkSync).toHaveBeenCalledWith('/app/tmp/original.jpg');
  });
});
