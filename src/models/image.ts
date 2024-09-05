// @ts-ignore
import Jimp from 'jimp';
import sizeOf from 'image-size';
import webp from 'webp-converter';

import {logger} from '../logger';
import {Path} from "../path";
import {CutPosition, FrameSideFetchedByFileId} from "./frameSide";

webp.grant_permission();

export async function cutImage(file: FrameSideFetchedByFileId, cutPosition: CutPosition, partialFilePath: Path) {
    let j1 = await Jimp.read(file.localFilePath);
    let j2 = j1.crop(
        cutPosition.left, cutPosition.top,
        cutPosition.width, cutPosition.height
    );

    logger.info(`Writing file cut`, {cutPosition, partialFilePath});
    await j2.writeAsync(partialFilePath);

    return partialFilePath
}

export function convertWebpToJpg(webpFilePath: string, jpgFilePath: string) {
    return webp.dwebp(webpFilePath, jpgFilePath, "-o");
}


export type SizePath = [number, Path]

export async function resizeImages(inputPath: string, map: SizePath[], quality = 70): Promise<SizePath[] | null> {
    logger.info('resizing image', {inputPath})
    // Open the image using Jimp
    const image = await Jimp.read(inputPath);

    // Get the image dimensions
    const width = image.getWidth();
    const height = image.getHeight();

    let result: SizePath[] = [];

    for await (let [maxDimension, outputPath] of map) {
        // Calculate new dimensions while maintaining the aspect ratio
        let {newWidth, newHeight} = calculateProportionalSizes(width, height, +maxDimension);

        await image.resize(newWidth, newHeight)
            .quality(quality)
            .write(outputPath);

        logger.info(`Image resized and saved`, {outputPath});

        result.push([maxDimension, outputPath]);
    }

    return result;
}


function calculateProportionalSizes(width: number, height: number, maxDimension: number) {
    let newWidth, newHeight;
    if (width > height) {
        newWidth = Math.min(maxDimension, width);
        newHeight = (newWidth / width) * height;
    } else {
        newHeight = Math.min(maxDimension, height);
        newWidth = (newHeight / height) * width;
    }
    return {newWidth, newHeight};
}

export function getImageSize(filepath) {
    return sizeOf(filepath)
}