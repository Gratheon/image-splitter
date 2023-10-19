import { convertDetectedBeesStorageFormat } from './frameSide';
import cellModel from './frameSideCells'

describe("countCellsAbsoluteNrs", () => {
	it("should count absolute cell numbers correctly", () => {
		const detections = [
			[1, 0.1, 0.1, 0.2, 100],

			[2, 0.1, 0.1, 0.2, 100],
			[2, 0.2, 0.2, 0.2, 100],

			[3, 0.1, 0.1, 0.2, 100],
			[3, 0.1, 0.1, 0.2, 100],
			[3, 0.1, 0.1, 0.2, 100],

			[4, 0.1, 0.1, 0.2, 100],
			[4, 0.1, 0.1, 0.2, 100],
			[4, 0.1, 0.1, 0.2, 100],
			[4, 0.1, 0.1, 0.2, 100],

			[5, 0.1, 0.1, 0.2, 100],
			[5, 0.1, 0.1, 0.2, 100],
			[5, 0.1, 0.1, 0.2, 100],
			[5, 0.1, 0.1, 0.2, 100],
			[5, 0.1, 0.1, 0.2, 100],

			[6, 0.1, 0.1, 0.2, 100],
			[6, 0.1, 0.1, 0.2, 100],
			[6, 0.1, 0.1, 0.2, 100],
			// Add more test cases
		];

		const result = cellModel.countCellsAbsoluteNrs(detections);

		expect(result.capped_brood).toBe(0);
		expect(result.eggs).toBe(1);
		expect(result.honey).toBe(2);
		expect(result.brood).toBe(3);
		expect(result.nectar).toBe(4);
		expect(result.empty).toBe(5);
		expect(result.pollen).toBe(3);
	});
});


describe("getRelativeCounts", () => {
	it("should calculate relative cell counts correctly", () => {
		const cellCounts = {
			honey: 1,
			brood: 2,
			eggs: 3,
			capped_brood: 4,
			pollen: 5,
			nectar: 6,
			empty: 7,
		};

		const result = cellModel.getRelativeCounts(cellCounts);

		expect(result.honey).toBe(3);
		expect(result.brood).toBe(7);
		expect(result.eggs).toBe(10);
		expect(result.capped_brood).toBe(14);
		expect(result.pollen).toBe(17);
		expect(result.nectar).toBe(21);
		expect(result.empty).toBe(25);
	});
});