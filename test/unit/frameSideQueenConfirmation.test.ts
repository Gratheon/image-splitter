jest.mock('../../src/models/storage', () => ({
	storage: jest.fn(),
}));

import frameSideModel from '../../src/models/frameSide';
import { storage } from '../../src/models/storage';

describe('frameSideModel.updateQueenConfirmation', () => {
	const mockQuery = jest.fn();

	beforeEach(() => {
		jest.clearAllMocks();
		(storage as jest.Mock).mockReturnValue({ query: mockQuery });
		mockQuery.mockResolvedValue({ affectedRows: 1 });
	});

	it('returns false and skips DB update for invalid ids', async () => {
		const invalidFrameSideResult = await frameSideModel.updateQueenConfirmation('abc', true, '7');
		const invalidUidResult = await frameSideModel.updateQueenConfirmation('123', true, 'uid');

		expect(invalidFrameSideResult).toBe(false);
		expect(invalidUidResult).toBe(false);
		expect(mockQuery).not.toHaveBeenCalled();
	});

	it('updates latest record when ids are valid', async () => {
		const result = await frameSideModel.updateQueenConfirmation('123', true, '7');

		expect(result).toBe(true);
		expect(mockQuery).toHaveBeenCalledTimes(1);
		expect(mockQuery.mock.calls[0][0]).toBeDefined();
	});
});
