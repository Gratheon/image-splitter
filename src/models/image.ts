// @ts-ignore
import {Jimp} from "jimp";
import sharp from 'sharp';
import webp from 'webp-converter';
import fs from 'fs';

import {logger} from '../logger';
import {AbsolutePath, Path} from "../path";
import {CutPosition, FrameSideFetchedByFileId} from "./frameSide";
import config from "../config";

webp.grant_permission();

export async function cutImage(file: FrameSideFetchedByFileId, cutPosition: CutPosition): Promise<Buffer> {

    // @ts-ignore
    let j1 = await Jimp.fromBuffer(file.imageBytes);

    let j2 = j1.crop({
        x: cutPosition.left,
        y: cutPosition.top,
        w: cutPosition.width,
        h: cutPosition.height
    });

    return j2.getBuffer("image/jpeg")
}

export function convertWebpToJpg(webpFilePath: string, jpgFilePath: string) {
    return webp.dwebp(webpFilePath, jpgFilePath, "-o");
}

export type SizePath = [number, Path]

export async function resizeImages(inputPath: string, map: SizePath[], quality = 70): Promise<SizePath[] | null> {
    logger.info('resizing image', {inputPath})

    // Check if we need to preprocess the image for memory efficiency
    let processPath = inputPath;
    let needsCleanup = false;

    try {
        const metadata = await sharp(inputPath).metadata();
        if (metadata.width && metadata.height) {
            // For very large images, preprocess them to avoid memory issues
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
        logger.warn('Sharp failed, falling back to Jimp', { filepath: inputPath, error: error instanceof Error ? error.message : String(error) });
    }

    // Open the image using Jimp
    // @ts-ignore
    const image = await Jimp.read(processPath);

    // Get the image dimensions
    const width = image.bitmap.width;
    const height = image.bitmap.height;

    let result: SizePath[] = [];

    for await (let [maxDimension, outputPath] of map) {
        // Calculate new dimensions while maintaining the aspect ratio
        let {newWidth, newHeight} = calculateProportionalSizes(width, height, +maxDimension);

        // @ts-ignore
        await image.resize({w: newWidth, h: newHeight}).write(outputPath);

        logger.info(`Image resized and saved`, {outputPath});

        result.push([maxDimension, outputPath]);
    }

    // Clean up preprocessed file if we created one
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
    try {
        const metadata = await sharp(filepath).metadata();

        if (metadata.width && metadata.height) {
            if (metadata.width > 4096 || metadata.height > 4096) {
                const preprocessedPath = await preprocessLargeImage(filepath);
                if (preprocessedPath) {
                    const preprocessedMetadata = await sharp(preprocessedPath).metadata();

                    setTimeout(() => {
                        if (fs.existsSync(preprocessedPath)) {
                            fs.unlinkSync(preprocessedPath);
                            logger.info('Cleaned up preprocessed file', { preprocessedPath });
                        }
                    }, 5000);

                    return {
                        width: preprocessedMetadata.width || 0,
                        height: preprocessedMetadata.height || 0
                    };
                }
            }

            return {
                width: metadata.width,
                height: metadata.height
            };
        }
    } catch (error) {
        logger.warn('Sharp failed, falling back to Jimp', { filepath, error: error instanceof Error ? error.message : String(error) });
    }

    // @ts-ignore
    const image = await Jimp.read(filepath);
    return {
        width: image.bitmap.width,
        height: image.bitmap.height
    }
}

export function getOriginalFileLocalPath(uid: string, uploadedOriginalFileName: string): AbsolutePath {
    return `${config.rootPath}tmp/${uid}_${uploadedOriginalFileName}`
}