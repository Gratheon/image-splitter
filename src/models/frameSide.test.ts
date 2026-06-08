import frameSideModel, { convertDetectedBeesStorageFormat, CutPosition } from './frameSide';
import { storage } from './storage';

jest.mock('./storage', () => ({
	storage: jest.fn(),
}));

const mockQuery = jest.fn();

beforeEach(() => {
	mockQuery.mockReset();
	(storage as jest.Mock).mockReturnValue({
		query: mockQuery,
	});
});

it('converts yolo to json', async () => {
	const cut: CutPosition = {
		width: 1000, height: 1000,
		left: 0, top: 0,
		x: 0, y: 0,
		maxCutsX: 1, maxCutsY: 1,
	}

	const result = convertDetectedBeesStorageFormat(
		`1 0.842303 0.931858 0.0815972 0.105035 1
2 0.63397 0.158854 0.0677083 0.170139 2`,
		cut
	)

	expect(result).toEqual([
		{ "n": "1", "x": 0.8423, "y": 0.93186, "w": 0.0816, "h": 0.105, "c": 1 },
		{ "n": "2", "x": 0.63397, "y": 0.15885, "w": 0.0677, "h": 0.1701, "c": 2 }
	])
})

it('empty text returns empty array', async () => {
	const cut = {
		width: 1000, height: 1000,
		left: 0, top: 0,
		x: 0, y: 0,
		maxCutsX: 1, maxCutsY: 1,
	}
	const result = convertDetectedBeesStorageFormat('', cut)

	expect(result).toEqual([])
})

it('updateQueens preserves existing queen_detected flag when a later chunk has no detections', async () => {
	mockQuery
		.mockResolvedValueOnce([
			{
				file_id: 42,
				is_queen_confirmed: 0,
				detected_queens: [{ n: '3', x: 0.1, y: 0.2, w: 0.03, h: 0.04, c: 0.9 }],
			},
		])
		.mockResolvedValueOnce({ affectedRows: 1 });

	await frameSideModel.updateQueens([], 7, 99);

	expect(mockQuery).toHaveBeenCalledTimes(2);
	const updateQuery = mockQuery.mock.calls[1][0] as any;
	const updateQueryJson = JSON.stringify(updateQuery);
	expect(updateQueryJson).toContain('queen_detected = (queen_detected OR ');
	expect(updateQueryJson).toContain('"value":false');
});
