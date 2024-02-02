export type DetectedFrameResource = [
	number, // class: ["Capped", "Eggs", "Honey", "Larves", "Nectar", "Other", "Pollen"]
	number, // x
	number, // y
	number, // radius
	number // probability
]

export type DetectedRectangle = {
	n: String, // class
	// 10 - queen cup
	x: number
	y: number

	x2: number
	y2: number
	c: number // confidence
}