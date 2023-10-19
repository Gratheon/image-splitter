import { convertDetectedBeesStorageFormat } from './frameSide';

it('converts yolo to json', async () => {
	const cut = {
		width: 1000, height: 1000, left: 0, top: 0
	}
	expect(convertDetectedBeesStorageFormat(`1 0.842303 0.931858 0.0815972 0.105035 1
2 0.63397 0.158854 0.0677083 0.170139 2`, cut, 1, 1)).toEqual([
		{ "n": "1", "x": 0.8423, "y": 0.93186, "w": 0.0816, "h": 0.105, "c": 1 },
		{ "n": "2", "x": 0.63397, "y": 0.15885, "w": 0.0677, "h": 0.1701, "c": 2 }
	])
})

it('empty text returns empty array', async () => {
	const cut = {
		width: 1000, height: 1000, left: 0, top: 0
	}
	expect(convertDetectedBeesStorageFormat('', cut, '', '')).toEqual([])
})