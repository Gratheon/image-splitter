import { describe, it, expect } from '@jest/globals';

describe('Varroa Bottom Detection Coordinate Normalization', () => {
    it('should normalize pixel coordinates to 0-1 range', () => {
        const imageWidth = 4032;
        const imageHeight = 3024;

        const rawDetection = {
            x1: 2193.93,
            y1: 1836.99,
            x2: 2257.26,
            y2: 1905.63,
            confidence: 0.92
        };

        const centerX = (rawDetection.x1 + rawDetection.x2) / 2;
        const centerY = (rawDetection.y1 + rawDetection.y2) / 2;
        const width = rawDetection.x2 - rawDetection.x1;

        const normalized = {
            x: parseFloat((centerX / imageWidth).toFixed(4)),
            y: parseFloat((centerY / imageHeight).toFixed(4)),
            w: parseFloat((width / imageWidth).toFixed(4)),
            c: parseFloat(rawDetection.confidence.toFixed(2))
        };

        expect(normalized.x).toBeGreaterThanOrEqual(0);
        expect(normalized.x).toBeLessThanOrEqual(1);
        expect(normalized.y).toBeGreaterThanOrEqual(0);
        expect(normalized.y).toBeLessThanOrEqual(1);
        expect(normalized.w).toBeGreaterThanOrEqual(0);
        expect(normalized.w).toBeLessThanOrEqual(1);
        expect(normalized.c).toBeGreaterThanOrEqual(0);
        expect(normalized.c).toBeLessThanOrEqual(1);

        expect(normalized.x).toBeCloseTo(0.5586, 4);
        expect(normalized.y).toBeCloseTo(0.6187, 4);
        expect(normalized.w).toBeCloseTo(0.0157, 4);
        expect(normalized.c).toBe(0.92);
    });

    it('should handle edge case at image boundaries', () => {
        const imageWidth = 4032;
        const imageHeight = 3024;

        const rawDetection = {
            x1: 0,
            y1: 0,
            x2: 50,
            y2: 50,
            confidence: 0.85
        };

        const centerX = (rawDetection.x1 + rawDetection.x2) / 2;
        const centerY = (rawDetection.y1 + rawDetection.y2) / 2;
        const width = rawDetection.x2 - rawDetection.x1;

        const normalized = {
            x: parseFloat((centerX / imageWidth).toFixed(4)),
            y: parseFloat((centerY / imageHeight).toFixed(4)),
            w: parseFloat((width / imageWidth).toFixed(4)),
            c: parseFloat(rawDetection.confidence.toFixed(2))
        };

        expect(normalized.x).toBeGreaterThanOrEqual(0);
        expect(normalized.y).toBeGreaterThanOrEqual(0);
        expect(normalized.w).toBeGreaterThanOrEqual(0);
    });

    it('should round to reasonable precision (4 decimals for coords, 2 for confidence)', () => {
        const imageWidth = 4032;
        const imageHeight = 3024;

        const rawDetection = {
            x1: 2193.9312341234,
            y1: 1836.9987654321,
            x2: 2257.2623456789,
            y2: 1905.6345678901,
            confidence: 0.9199939370155334
        };

        const centerX = (rawDetection.x1 + rawDetection.x2) / 2;
        const centerY = (rawDetection.y1 + rawDetection.y2) / 2;
        const width = rawDetection.x2 - rawDetection.x1;

        const normalized = {
            x: parseFloat((centerX / imageWidth).toFixed(4)),
            y: parseFloat((centerY / imageHeight).toFixed(4)),
            w: parseFloat((width / imageWidth).toFixed(4)),
            c: parseFloat(rawDetection.confidence.toFixed(2))
        };

        const xStr = normalized.x.toString();
        const yStr = normalized.y.toString();
        const wStr = normalized.w.toString();
        const cStr = normalized.c.toString();

        expect(xStr.split('.')[1]?.length || 0).toBeLessThanOrEqual(4);
        expect(yStr.split('.')[1]?.length || 0).toBeLessThanOrEqual(4);
        expect(wStr.split('.')[1]?.length || 0).toBeLessThanOrEqual(4);
        expect(cStr.split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
    });

    it('should fail if coordinates exceed 1 (indicating wrong normalization)', () => {
        const imageWidth = 1000;
        const imageHeight = 1000;

        const rawDetection = {
            x1: 500,
            y1: 500,
            x2: 600,
            y2: 600,
            confidence: 0.92
        };

        const centerX = (rawDetection.x1 + rawDetection.x2) / 2;
        const centerY = (rawDetection.y1 + rawDetection.y2) / 2;
        const width = rawDetection.x2 - rawDetection.x1;

        const normalized = {
            x: parseFloat((centerX / imageWidth).toFixed(4)),
            y: parseFloat((centerY / imageHeight).toFixed(4)),
            w: parseFloat((width / imageWidth).toFixed(4)),
            c: parseFloat(rawDetection.confidence.toFixed(2))
        };

        expect(normalized.x).toBeLessThanOrEqual(1);
        expect(normalized.y).toBeLessThanOrEqual(1);
        expect(normalized.w).toBeLessThanOrEqual(1);
    });

    it('should demonstrate the bug from production data', () => {
        const buggyData = {
            c: 0.9199939370155334,
            w: 0.020630915959676106,
            x: 1.2347479263941448,
            y: 0.7448616921901703
        };

        expect(buggyData.x).toBeGreaterThan(1); // This shows the bug!
        expect(buggyData.c).toBeCloseTo(0.92, 2); // Should be rounded
    });
});

