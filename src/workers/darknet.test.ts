import { parseYoloText } from "./darknet";

it('converts yolo to json', async()=>{
	expect(parseYoloText(`0 0.842303 0.931858 0.0815972 0.105035
0 0.63397 0.158854 0.0677083 0.170139`)).toEqual([
	{"n": "0", "p": [0.842303, 0.931858, 0.0815972, 0.105035]},
	{"n": "0", "p": [0.63397, 0.158854, 0.0677083, 0.170139]}
])
})


it('empty text returns empty array', async()=>{
	expect(parseYoloText(``)).toEqual([])
})