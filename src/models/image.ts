// @ts-ignore
import { Jimp } from "jimp";
import sizeOf from 'image-size';
import webp from 'webp-converter';

import {logger} from '../logger';
import {Path} from "../path";
import {CutPosition, FrameSideFetchedByFileId} from "./frameSide";

webp.grant_permission();

export async function cutImage(file: FrameSideFetchedByFileId, cutPosition: CutPosition, partialFilePath: Path): Promise<Buffer> {

    // @ts-ignore
    let j1 = await Jimp.fromBuffer(file.imageBytes);

    let j2 = j1.crop({
        x: cutPosition.left,
        y: cutPosition.top,
        w: cutPosition.width,
        h: cutPosition.height
    });

    logger.info(`Writing file cut`, {cutPosition, partialFilePath});
    // @ts-ignore
    // await j2.write(partialFilePath);
    return j2.getBuffer("image/jpeg")

    // return partialFilePath
}

export function convertWebpToJpg(webpFilePath: string, jpgFilePath: string) {
    return webp.dwebp(webpFilePath, jpgFilePath, "-o");
}


export type SizePath = [number, Path]

export async function resizeImages(inputPath: string, map: SizePath[], quality = 70): Promise<SizePath[] | null> {
    logger.info('resizing image', {inputPath})
    // Open the image using Jimp
    // @ts-ignore
    const image = await Jimp.read(inputPath);

    // Get the image dimensions
    const width = image.bitmap.width;
    const height = image.bitmap.height;

    let result: SizePath[] = [];

    for await (let [maxDimension, outputPath] of map) {
        // Calculate new dimensions while maintaining the aspect ratio
        let {newWidth, newHeight} = calculateProportionalSizes(width, height, +maxDimension);

        // @ts-ignore
        await image.resize({w:newWidth, h:newHeight}).write(outputPath);

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