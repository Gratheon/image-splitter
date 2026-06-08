import { normalizeQueenDetection } from './detectQueens';
import { CutPosition } from '../models/frameSide';

describe('detectQueens helpers', () => {
  const cutPosition: CutPosition = {
    x: 1,
    y: 1,
    width: 1000,
    height: 800,
    left: 1000,
    top: 800,
    maxCutsX: 2,
    maxCutsY: 2,
  };

  test('normalizes queen detector pixel box to original image coordinates', () => {
    const result = normalizeQueenDetection(
      {
        class_id: 0,
        class_name: 'queen',
        confidence: 0.913,
        box: [100, 80, 300, 280],
      },
      cutPosition,
      { width: 2000, height: 1600 },
    );

    expect(result).toEqual({
      n: '3',
      x: 0.6,
      y: 0.6125,
      w: 0.1,
      h: 0.125,
      c: 0.91,
    });
  });

  test('skips non-queen classes', () => {
    const result = normalizeQueenDetection(
      {
        class_id: 1,
        class_name: 'worker',
        confidence: 0.9,
        box: [100, 80, 300, 280],
      },
      cutPosition,
      { width: 2000, height: 1600 },
    );

    expect(result).toBeNull();
  });

  test('rejects invalid boxes', () => {
    const result = normalizeQueenDetection(
      {
        class_id: 0,
        class_name: 'queen',
        confidence: 0.9,
        box: [300, 280, 100, 80],
      },
      cutPosition,
      { width: 2000, height: 1600 },
    );

    expect(result).toBeNull();
  });
});
