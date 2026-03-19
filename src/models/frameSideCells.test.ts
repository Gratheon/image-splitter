import { convertDetectedBeesStorageFormat } from './frameSide';
import cellModel from './frameSideCells'
import { storage } from './storage'

jest.mock('./storage', () => ({
	storage: jest.fn(),
}));

const mockQuery = jest.fn();

beforeEach(() => {
	mockQuery.mockResolvedValue([]);
	(storage as jest.Mock).mockReturnValue({
		query: mockQuery,
	});
});

afterEach(() => {
	jest.clearAllMocks();
});

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
		expect(result.drone_brood).toBe(0);
	});
});


describe("getRelativeCounts", () => {
	it("should calculate relative cell counts correctly", () => {
		const cellCounts = {
			honey: 1,
			brood: 2,
			drone_brood: 0,
			eggs: 3,
			capped_brood: 4,
			pollen: 5,
			nectar: 6,
			empty: 7,
		};

		const result = cellModel.getRelativeCounts(cellCounts);

		expect(result.honey).toBe(3);
		expect(result.brood).toBe(7);
		expect(result.drone_brood).toBe(0);
		expect(result.eggs).toBe(10);
		expect(result.capped_brood).toBe(14);
		expect(result.pollen).toBe(17);
		expect(result.nectar).toBe(21);
		expect(result.empty).toBe(25);
	});
});

describe("updateRelativeCells", () => {
	it("stores full cells payload and derived counts when cells array is provided", async () => {
		const cellsInput = {
			id: 99,
			cells: [
				[2, 0.1, 0.1, 0.01, 100], // honey
				[3, 0.2, 0.2, 0.01, 100], // brood
				[6, 0.3, 0.3, 0.01, 100], // pollen
				[5, 0.4, 0.4, 0.01, 100], // empty
			],
		};

		await cellModel.updateRelativeCells(cellsInput, 7, 99);

		expect(mockQuery).toHaveBeenCalledTimes(1);
		const queryArg = mockQuery.mock.calls[0][0];
		expect(queryArg).toBeDefined();
	});

	it("stores only relative percentages when no cells array is provided", async () => {
		const cellsInput = {
			id: 44,
			broodPercent: 11,
			cappedBroodPercent: 22,
			eggsPercent: 33,
			pollenPercent: 44,
			honeyPercent: 55,
		};

		await cellModel.updateRelativeCells(cellsInput, 8, 44);

		expect(mockQuery).toHaveBeenCalledTimes(1);
		const queryArg = mockQuery.mock.calls[0][0];
		expect(queryArg).toBeDefined();
	});
});
