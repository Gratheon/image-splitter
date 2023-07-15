import { convertDetectedBeesStorageFormat } from "./darknet";

it('converts yolo to json', async()=>{
	const cut = {
		width:1000, height:1000, left:0, top:0
	}
	expect(convertDetectedBeesStorageFormat(`1 0.842303 0.931858 0.0815972 0.105035
2 0.63397 0.158854 0.0677083 0.170139`, cut, 0, 0)).toEqual([
	{"n": "1", "x": 0.842303, "y":0.931858, "w":0.0815972, "h":0.105035},
	{"n": "2", "x": 0.63397, "y":0.158854, "w":0.0677083, "h":0.170139}
])
})

it('empty text returns empty array', async()=>{
	const cut = {
		width:1000, height:1000, left:0, top:0
	}
	expect(convertDetectedBeesStorageFormat('',cut,'','')).toEqual([])
})