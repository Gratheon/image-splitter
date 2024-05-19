import { logger } from "../logger";
import { CutPosition } from "../models/frameSide";

export async function retryAsyncFunction(asyncFunction, maxRetries) {
	let retries = 0;
	while (retries < maxRetries) {
		try {
			return await asyncFunction();
		} catch (error) {
			logger.warn(`Attempt ${retries + 1} failed`);
			logger.warn(error);
			retries++;
			if (retries < maxRetries) {
				await sleep(60)
			}
		}
	}
	throw new Error(`Exceeded maximum retries (${maxRetries}).`);
}

export async function sleep(sec = 1) {
	// slow down API for security to slow down brute-force
	await new Promise(resolve => setTimeout(resolve, sec * 1000));
}


export function roundToDecimal(num: number, decimalPlaces: number): number {
	const multiplier = Math.pow(10, decimalPlaces);
	return Math.round(num * multiplier) / multiplier;
}

export function convertClarifaiCoords(bounding_box, cutPosition: CutPosition): any {
	const { top_row, left_col, bottom_row, right_col } = bounding_box

	logger.info("varroa coords", bounding_box)

	let h = bottom_row - top_row;
	let w = right_col - left_col;
	let x = left_col + w / 2;
	let y = bottom_row - h / 2;

	if (cutPosition.maxCutsX > 0) {
		x = (Number(x) * cutPosition.width + cutPosition.left) / (cutPosition.maxCutsX * cutPosition.width)
		w = Number(w) / (cutPosition.maxCutsX)
	}

	if (cutPosition.maxCutsY > 0) {
		y = (Number(y) * cutPosition.height + cutPosition.top) / (cutPosition.maxCutsY * cutPosition.height)
		h = Number(h) / cutPosition.maxCutsY
	}

	return {
		x: roundToDecimal(x, 5),
		y: roundToDecimal(y, 5),
		h: roundToDecimal(h, 4),
		w: roundToDecimal(w, 4),
	}
}