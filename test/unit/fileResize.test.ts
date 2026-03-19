jest.mock('../../src/models/storage', () => ({
  storage: jest.fn(),
}));

jest.mock('../../src/config/index', () => ({
  __esModule: true,
  default: {
    aws: {
      url: { public: 'https://cdn.example/' },
    },
  },
}));

import fileResizeModel from '../../src/models/fileResize';
import { storage } from '../../src/models/storage';

describe('fileResize model', () => {
  const mockQuery = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (storage as jest.Mock).mockReturnValue({ query: mockQuery });
  });

  test('insertResize returns inserted id', async () => {
    mockQuery.mockResolvedValue([{ id: 41 }]);
    await expect(fileResizeModel.insertResize(7, 1024)).resolves.toBe(41);
  });

  test('getResizes maps DB rows to FileResize objects', async () => {
    mockQuery.mockResolvedValue([
      { id: 1, max_dimension_px: 512, hash: 'abc', user_id: 9, ext: 'jpg' },
      { id: 2, max_dimension_px: 128, hash: 'def', user_id: 9, ext: null },
    ]);

    const resizes = await fileResizeModel.getResizes(88, 9);

    expect(resizes).toEqual([
      {
        __typename: 'FileResize',
        id: 1,
        file_id: 88,
        max_dimension_px: 512,
        url: 'https://cdn.example/9/abc/512.jpg',
      },
      {
        __typename: 'FileResize',
        id: 2,
        file_id: 88,
        max_dimension_px: 128,
        url: 'https://cdn.example/9/def/128',
      },
    ]);
  });
});
