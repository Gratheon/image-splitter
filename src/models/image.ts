import sharp from 'sharp';
import webp from 'webp-converter';
import fs from 'fs';

import {logger} from '../logger';
import {AbsolutePath, Path} from "../path";
import {CutPosition, FrameSideFetchedByFileId} from "./frameSide";
import config from "../config";

webp.grant_permission();

export async function cutImage(file: FrameSideFetchedByFileId, cutPosition: CutPosition): Promise<Buffer> {
    return await sharp(file.imageBytes)
        .extract({
            left: cutPosition.left,
            top: cutPosition.top,
            width: cutPosition.width,
            height: cutPosition.height
        })
        .jpeg()
        .toBuffer();
}

export function convertWebpToJpg(webpFilePath: string, jpgFilePath: string) {
    return webp.dwebp(webpFilePath, jpgFilePath, "-o");
}

export type SizePath = [number, Path]

export async function resizeImages(inputPath: string, map: SizePath[], quality = 70): Promise<SizePath[] | null> {
    logger.info('resizing image', {inputPath})

    let processPath = inputPath;
    let needsCleanup = false;

    try {
        const metadata = await sharp(inputPath).metadata();
        if (metadata.width && metadata.height) {
            if (metadata.width > 4096 || metadata.height > 4096) {
                const preprocessedPath = await preprocessLargeImage(inputPath);
                if (preprocessedPath) {
                    processPath = preprocessedPath;
                    needsCleanup = true;
                    logger.info('Using preprocessed image for resizing', { preprocessedPath });
                } else {
                    logger.warn('Could not preprocess large image, proceeding with original', { inputPath });
                }
            }
        }
    } catch (error) {
        logger.error('Sharp metadata failed for resizing', { filepath: inputPath, error: error instanceof Error ? error.message : String(error) });
        throw error;
    }

    let result: SizePath[] = [];

    for (let [maxDimension, outputPath] of map) {
        const metadata = await sharp(processPath).metadata();
        const width = metadata.width || 0;
        const height = metadata.height || 0;

        let {newWidth, newHeight} = calculateProportionalSizes(width, height, +maxDimension);

        await sharp(processPath)
            .resize(Math.round(newWidth), Math.round(newHeight), {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality })
            .toFile(outputPath);

        logger.info(`Image resized and saved`, {outputPath});

        result.push([maxDimension, outputPath]);
    }

    if (needsCleanup && processPath !== inputPath) {
        try {
            fs.unlinkSync(processPath);
            logger.info('Cleaned up preprocessed file', { processPath });
        } catch (cleanupError) {
            logger.warn('Failed to clean up preprocessed file', { processPath, error: cleanupError });
        }
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

type ImageDimensions = {
    width: number,
    height: number
}

export async function preprocessLargeImage(filepath: Path, maxWidth: number = 4096, maxHeight: number = 4096): Promise<Path | null> {
    try {
        const metadata = await sharp(filepath).metadata();

        if (metadata.width && metadata.height) {
            if (metadata.width > maxWidth || metadata.height > maxHeight) {
                const preprocessedPath = filepath.replace(/(\.[^.]+)$/, '_preprocessed$1');

                await sharp(filepath)
                    .resize(maxWidth, maxHeight, {
                        fit: 'inside',
                        withoutEnlargement: true
                    })
                    .jpeg({ quality: 85 })
                    .toFile(preprocessedPath);

                logger.info('Large image preprocessed', {
                    originalSize: `${metadata.width}x${metadata.height}`,
                    filepath: preprocessedPath
                });

                return preprocessedPath;
            }
        }
    } catch (error) {
        logger.error('Failed to preprocess image with Sharp', { filepath, error });
    }

    return null;
}

export async function getImageDimensions(filepath: Path): Promise<ImageDimensions> {
    const metadata = await sharp(filepath).metadata();

    if (metadata.width && metadata.height) {
        return {
            width: metadata.width,
            height: metadata.height
        };
    }

    throw new Error(`Failed to get image dimensions from ${filepath}`);
}

export function getOriginalFileLocalPath(uid: string, uploadedOriginalFileName: string): AbsolutePath {
    return `${config.rootPath}tmp/${uid}_${uploadedOriginalFileName}`
}