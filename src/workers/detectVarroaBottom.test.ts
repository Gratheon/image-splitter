import {
    normalizeVarroaBottomDetection,
    normalizeVarroaBottomDetections,
} from './detectVarroaBottom';

describe('detectVarroaBottom normalization helpers', () => {
    it('normalizes pixel coordinates to 0-1 range with expected rounding', () => {
        const normalized = normalizeVarroaBottomDetection(
            {
                x1: 2193.93,
                y1: 1836.99,
                x2: 2257.26,
                y2: 1905.63,
                confidence: 0.9199939370155334,
            },
            {
                width: 4032,
                height: 3024,
            }
        );

        expect(normalized).toEqual({
            x: 0.552,
            y: 0.6188,
            w: 0.0157,
            c: 0.92,
        });
    });

    it('returns null when image dimensions are invalid', () => {
        const normalized = normalizeVarroaBottomDetection(
            {
                x1: 10,
                y1: 10,
                x2: 20,
                y2: 20,
                confidence: 0.9,
            },
            {
                width: 0,
                height: 1000,
            }
        );

        expect(normalized).toBeNull();
    });

    it('skips invalid detections in batch conversion', () => {
        const result = normalizeVarroaBottomDetections(
            [
                {
                    x1: 0,
                    y1: 0,
                    x2: 50,
                    y2: 50,
                    confidence: 0.85,
                },
                {
                    x1: Number.NaN,
                    y1: 0,
                    x2: 100,
                    y2: 100,
                    confidence: 0.9,
                },
            ],
            {
                width: 1000,
                height: 1000,
            }
        );

        expect(result).toEqual([
            {
                x: 0.025,
                y: 0.025,
                w: 0.05,
                c: 0.85,
            },
        ]);
    });
});
