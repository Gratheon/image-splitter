import { transformSubImageCoordsToOriginal, roundToDecimal } from './common';
import { CutPosition } from "../../models/frameSide"; // Adjust the import path

// Mock the logger module to prevent actual DB logging attempts during unit tests
jest.mock('../../logger');

describe('roundToDecimal', () => {
    test('rounds number to specified decimal places', () => {
        expect(roundToDecimal(3.1415926535, 2)).toBe(3.14);
        expect(roundToDecimal(3.1415926535, 4)).toBe(3.1416);
        expect(roundToDecimal(3.1415926535, 0)).toBe(3);
        expect(roundToDecimal(-1.23456, 3)).toBe(-1.235);
    });

    test('handles rounding to zero decimal places', () => {
        expect(roundToDecimal(1.9999, 0)).toBe(2);
        expect(roundToDecimal(1.4999, 0)).toBe(1);
    });

    test('handles rounding of very small and large numbers', () => {
        expect(roundToDecimal(0.000123456, 5)).toBe(0.00012);
        expect(roundToDecimal(123456789.123456, 3)).toBe(123456789.123);
    });
});

describe('transformSubImageCoordsToOriginal', () => {
    const bounding_box = {
        top_row: 0.1,
        left_col: 0.2,
        bottom_row: 0.8,
        right_col: 0.9
    };

    test('converts Clarifai coordinates with cutPosition having maxCutsX and maxCutsY > 0', () => {
        const cutPosition: CutPosition = {
            maxCutsX: 2,
            maxCutsY: 3,
            width: 100,
            height: 200,
            left: 10,
            top: 20,
            x: 0,
            y: 0,

        };

        // Recalculated expected values based on function logic
        // x = ( (0.2 + (0.9-0.2)/2) * 100 + 10 ) / (2 * 100) = (0.55 * 100 + 10) / 200 = 65 / 200 = 0.325
        // y = ( (0.1 + (0.8-0.1)/2) * 200 + 20 ) / (3 * 200) = (0.45 * 200 + 20) / 600 = 110 / 600 = 0.18333...
        // w = (0.9-0.2) / 2 = 0.7 / 2 = 0.35
        // h = (0.8-0.1) / 3 = 0.7 / 3 = 0.23333...
        const expectedX = roundToDecimal(0.325, 5);
        const expectedY = roundToDecimal(0.18333333333333332, 5); // Use full precision before rounding
        const expectedW = roundToDecimal(0.35, 4);
        const expectedH = roundToDecimal(0.23333333333333334, 4); // Use full precision before rounding

        const result = transformSubImageCoordsToOriginal(bounding_box, cutPosition);

        expect(result).toEqual({
            x: expectedX,
            y: expectedY,
            h: expectedH,
            w: expectedW,
        });
    });

    test('returns null for invalid cutPosition (maxCutsX = 0)', () => {
        const cutPosition: CutPosition = {
            maxCutsX: 0,
            maxCutsY: 0,
            width: 100,
            height: 200,
            left: 10,
            top: 20,
            x: 0,
            y: 0,
        };

        const result = transformSubImageCoordsToOriginal(bounding_box, cutPosition);

        // Expect null because the function validation should catch maxCutsX <= 0
        expect(result).toBeNull();
    });

    test('returns null for invalid cutPosition (maxCutsY = 0)', () => {
        const cutPosition: CutPosition = {
            maxCutsX: 2,
            maxCutsY: 0, // Invalid input
            width: 100,
            height: 200,
            left: 10,
            top: 20,
            x: 0,
            y: 0,
        };

        const result = transformSubImageCoordsToOriginal(bounding_box, cutPosition);

        // Expect null because the function validation should catch maxCutsY <= 0
        expect(result).toBeNull();
    });


    test('handles bounding box with zero width and height', () => {
        const bounding_box_zero = {
            top_row: 0.5,
            left_col: 0.5,
            bottom_row: 0.5,
            right_col: 0.5
        };
        const cutPosition: CutPosition = {
            maxCutsX: 1,
            maxCutsY: 1,
            width: 100,
            height: 100,
            left: 0,
            top: 0,
            x: 0,
            y: 0,
        };

        const result = transformSubImageCoordsToOriginal(bounding_box_zero, cutPosition);

        expect(result).toEqual({
            x: roundToDecimal(0.5, 5),
            y: roundToDecimal(0.5, 5),
            h: roundToDecimal(0, 4),
            w: roundToDecimal(0, 4),
        });
    });
});
