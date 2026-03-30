import { convertDetectedResourcesStorageFormat } from './detectCells';

describe('detectCells helpers', () => {
  test('convertDetectedResourcesStorageFormat normalizes and rounds values', () => {
    const result = convertDetectedResourcesStorageFormat(
      [
        [500, 250, 100, 2, 0, 0.913],
      ],
      1000,
      500,
    );

    expect(result).toEqual([
      [
        2,
        0.5,
        0.5,
        0.1,
        92,
      ],
    ]);
  });

  test('convertDetectedResourcesStorageFormat returns empty array on invalid input', () => {
    const result = convertDetectedResourcesStorageFormat(null as any, 1000, 500);
    expect(result).toEqual([]);
  });
});
