import { buildBeeCropBounds, mapVarroaDetectionToOriginal } from "./detectVarroa";

describe("detectVarroa bee-crop mapping", () => {
  test("buildBeeCropBounds clamps crop to image bounds", () => {
    const crop = buildBeeCropBounds(
      {
        n: "0",
        x: 0.02,
        y: 0.03,
        w: 0.05,
        h: 0.04,
        c: 0.9,
      },
      4000,
      3000,
    );

    expect(crop).not.toBeNull();
    expect(crop!.left).toBeGreaterThanOrEqual(0);
    expect(crop!.top).toBeGreaterThanOrEqual(0);
    expect(crop!.width).toBeGreaterThan(0);
    expect(crop!.height).toBeGreaterThan(0);
    expect(crop!.left + crop!.width).toBeLessThanOrEqual(4000);
    expect(crop!.top + crop!.height).toBeLessThanOrEqual(3000);
  });

  test("mapVarroaDetectionToOriginal maps crop coordinates into normalized full-image coordinates", () => {
    const mapped = mapVarroaDetectionToOriginal(
      {
        x1: 20,
        y1: 10,
        x2: 60,
        y2: 30,
        confidence: 0.87,
      },
      {
        left: 100,
        top: 200,
        width: 200,
        height: 100,
      },
      1000,
      1000,
    );

    expect(mapped).not.toBeNull();
    expect(mapped!.n).toBe("11");
    expect(mapped!.c).toBe(0.87);
    expect(mapped!.x).toBeCloseTo(0.14, 5);
    expect(mapped!.y).toBeCloseTo(0.22, 5);
    expect(mapped!.w).toBeCloseTo(0.04, 4);
    expect(mapped!.h).toBeCloseTo(0.02, 4);
  });

  test("buildBeeCropBounds returns null for non-finite bee values", () => {
    const crop = buildBeeCropBounds(
      {
        n: "0",
        x: Number.NaN,
        y: 0.5,
        w: 0.1,
        h: 0.1,
        c: 0.9,
      },
      1000,
      1000,
    );

    expect(crop).toBeNull();
  });

  test("mapVarroaDetectionToOriginal returns null for invalid or zero-area boxes", () => {
    const invalid = mapVarroaDetectionToOriginal(
      {
        x1: Number.NaN,
        y1: 10,
        x2: 50,
        y2: 20,
        confidence: 0.9,
      },
      {
        left: 10,
        top: 20,
        width: 100,
        height: 100,
      },
      1000,
      1000,
    );

    const zeroArea = mapVarroaDetectionToOriginal(
      {
        x1: 20,
        y1: 20,
        x2: 20,
        y2: 40,
        confidence: 0.9,
      },
      {
        left: 10,
        top: 20,
        width: 100,
        height: 100,
      },
      1000,
      1000,
    );

    expect(invalid).toBeNull();
    expect(zeroArea).toBeNull();
  });
});
