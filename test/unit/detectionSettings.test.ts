jest.mock('../../src/models/storage', () => ({
  storage: jest.fn(),
}));

import detectionSettingsModel, {
  resolveThresholdFromPayload,
} from '../../src/models/detectionSettings';
import { storage } from '../../src/models/storage';

describe('detectionSettings model', () => {
  const mockQuery = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (storage as jest.Mock).mockReturnValue({ query: mockQuery });
  });

  test('resolveThresholdFromPayload derives thresholds from confidence percents', () => {
    const threshold = resolveThresholdFromPayload(
      { detectionConfidencePercents: { bees: 80 } },
      'bees',
    );
    const fallback = resolveThresholdFromPayload({}, 'queens');
    const overridden = resolveThresholdFromPayload(
      { detectionConfidencePercents: { bees: 80 }, detectionThresholds: { bees: 0.33 } },
      'bees',
    );

    expect(threshold).toBe(0.8);
    expect(fallback).toBe(0.6);
    expect(overridden).toBe(0.33);
  });

  test('getByUserId normalizes legacy and per-type values', async () => {
    mockQuery.mockResolvedValue([
      {
        userId: 99,
        minConfidencePercent: 70,
        bees: 80,
        drones: undefined,
        queens: 50,
        queenCups: 90,
        varroa: 40,
        varroaBottom: 60,
      },
    ]);

    const result = await detectionSettingsModel.getByUserId(99);

    expect(result.userId).toBe(99);
    expect(result.confidencePercents).toEqual({
      bees: 80,
      drones: 70,
      queens: 50,
      queenCups: 90,
      varroa: 40,
      varroaBottom: 60,
    });
    expect(result.thresholds).toEqual({
      bees: 0.8,
      drones: 0.7,
      queens: 0.5,
      queenCups: 0.9,
      varroa: 0.4,
      varroaBottom: 0.6,
    });
  });

  test('setConfidencePercents writes normalized values and returns refreshed settings', async () => {
    mockQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        {
          userId: 42,
          minConfidencePercent: 60,
          bees: 60,
          drones: 60,
          queens: 60,
          queenCups: 60,
          varroa: 60,
          varroaBottom: 60,
        },
      ]);

    const result = await detectionSettingsModel.setConfidencePercents(42, {
      bees: 90,
      drones: 123, // invalid option -> defaults to 60
    });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(result.confidencePercents.bees).toBe(60);
    expect(result.confidencePercents.drones).toBe(60);
    expect(result.thresholds.bees).toBe(0.6);
    expect(result.thresholds.drones).toBe(0.6);
  });

  test('getJobPayloadForUser returns confidence and thresholds payload', async () => {
    mockQuery.mockResolvedValue([
      {
        userId: 5,
        minConfidencePercent: 60,
        bees: 60,
        drones: 60,
        queens: 60,
        queenCups: 60,
        varroa: 60,
        varroaBottom: 60,
      },
    ]);

    const payload = await detectionSettingsModel.getJobPayloadForUser(5);
    expect(payload).toEqual({
      detectionConfidencePercents: {
        bees: 60,
        drones: 60,
        queens: 60,
        queenCups: 60,
        varroa: 60,
        varroaBottom: 60,
      },
      detectionThresholds: {
        bees: 0.6,
        drones: 0.6,
        queens: 0.6,
        queenCups: 0.6,
        varroa: 0.6,
        varroaBottom: 0.6,
      },
    });
  });
});
