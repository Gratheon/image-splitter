import Jimp from 'jimp';
import sizeOf from 'image-size';
import webp from 'webp-converter';

import { logger } from '../logger';

webp.grant_permission();

export async function cutImage(file, cutPosition, partialFilePath) {
	let j1 = await Jimp.read(file.localFilePath);
	let j2 = j1.crop(
		cutPosition.left,
		cutPosition.top,
		cutPosition.width,
		cutPosition.height
	);

	logger.info(`Writing cut to ${partialFilePath}`);
	await j2.writeAsync(partialFilePath);

	return partialFilePath
}

export function convertWebpToJpg(webpFilePath: string, jpgFilePath: string) {
	return webp.dwebp(webpFilePath, jpgFilePath, "-o");
}


export async function resizeImage(inputPath: string, outputPath: string, maxDimension: number, quality = 95) {
	try {
		// Open the image using Jimp
		const image = await Jimp.read(inputPath);

		// Get the image dimensions
		const width = image.getWidth();
		const height = image.getHeight();

		// Calculate new dimensions while maintaining the aspect ratio
		let newWidth, newHeight;
		if (width > height) {
			newWidth = Math.min(maxDimension, width);
			newHeight = (newWidth / width) * height;
		} else {
			newHeight = Math.min(maxDimension, height);
			newWidth = (newHeight / height) * width;
		}

		// Resize the image
		image.resize(newWidth, newHeight);

		// Save the resized image to the output path
		await image.quality(quality).writeAsync(outputPath);

		console.log(`Image resized and saved to ${outputPath}`);
	} catch (error) {
		console.error('Error:', error);
	}
}

export function getImageSize(filepath) {
	return sizeOf(filepath)
}