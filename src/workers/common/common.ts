import { promises as fsPromises } from "fs"; // Use promises API for async file reading
// FormData is no longer needed

import { logger } from "../../logger";
import { CutPosition, FrameSideFetchedByFileId } from "../../models/frameSide"; // Removed unused frameSideModel import
import * as imageModel from "../../models/image";
// generateChannelName and publisher are no longer needed here

// Define the expected signature for the sub-image handler callback
type SubImageHandler = (
    imageBytes: Buffer,
    cutPosition: CutPosition,
    fileId: number,
    filename: string // Added filename for potential logging/context in handler
) => Promise<void>;


// Pure function to calculate the grid dimensions
function calculateCutGrid(width: number, height: number, subImageDimensionPx: number): { maxCutsX: number, maxCutsY: number } {
    let maxCutsX = 1;
    let maxCutsY = 1;

    // Ensure subImageDimensionPx is positive to avoid division by zero or infinite loops
    if (subImageDimensionPx <= 0) {
        logger.warn(`calculateCutGrid: subImageDimensionPx is non-positive (${subImageDimensionPx}), defaulting to 1x1 grid.`);
        return { maxCutsX: 1, maxCutsY: 1 };
    }

    if (width > subImageDimensionPx) {
        maxCutsX = Math.floor(width / subImageDimensionPx);
    }
    // Bug fix: Check height against subImageDimensionPx, not width
    if (height > subImageDimensionPx) {
        maxCutsY = Math.floor(height / subImageDimensionPx);
    }
    // Ensure at least one cut even if dimensions are smaller
    maxCutsX = Math.max(1, maxCutsX);
    maxCutsY = Math.max(1, maxCutsY);

    return { maxCutsX, maxCutsY };
}


export async function splitIn9ImagesAndDetect(file: FrameSideFetchedByFileId, subImageDimensionPx = 800, subImageHandler: SubImageHandler) {
    // Validate input file object
    if (!file || !file.file_id || !file.width || !file.height || !file.localFilePath || !file.filename) {
        logger.error("splitIn9ImagesAndDetect: Invalid 'file' object received.", { file });
        throw new Error("Invalid file data provided to splitIn9ImagesAndDetect.");
    }
    logger.info(`splitIn9ImagesAndDetect: Starting for file_id ${file.file_id}, frame_side_id ${file.frame_side_id}`);

    const { maxCutsX, maxCutsY } = calculateCutGrid(file.width, file.height, subImageDimensionPx);
    logger.info(`splitIn9ImagesAndDetect: Calculated cuts: ${maxCutsX} x ${maxCutsY}`);

    // Read the entire image file into memory once.
    let imageBytes: Buffer;
    try {
        imageBytes = await fsPromises.readFile(file.localFilePath);
        // Assign to file object property if imageModel.cutImage expects it
        // This assumes FrameSideFetchedByFileId allows adding imageBytes or is extended
        (file as any).imageBytes = imageBytes;
    } catch (readError) {
        logger.error(`splitIn9ImagesAndDetect: Failed to read image file ${file.localFilePath}`, { error: readError });
        // Propagate the error to stop processing if the file can't be read
        throw new Error(`Failed to read image file: ${file.localFilePath}`);
    }

    // Optional: Check for unusually small file size
    if (imageBytes.length < 1000) {
        logger.warn('Image seems potentially small.', { file_id: file.file_id, path: file.localFilePath, size: imageBytes.length });
        // Consider reading as utf8 only if logging the warning, but it might fail for binary files
        // try {
        //     const contentSample = await fsPromises.readFile(file.localFilePath, 'utf8');
        //     logger.warn('Small image content sample (if readable as text):', { contentSample });
        // } catch (utf8ReadError) {
        //     logger.warn('Could not read small image file as utf8 for logging.');
        // }
    }

    // Process each cut sequentially
    let partCounter = 0;
    const totalParts = maxCutsX * maxCutsY;

    for (let y = 0; y < maxCutsY; y++) { // Iterate Y outer, X inner - often more cache-friendly for image processing
        for (let x = 0; x < maxCutsX; x++) {
            partCounter++;
            logger.info(`splitIn9ImagesAndDetect: Processing part ${partCounter}/${totalParts} (x=${x}, y=${y})`);

            // Calculate dimensions and position for the current cut
            // Ensure integer dimensions by flooring
            const cutWidth = Math.floor(file.width / maxCutsX);
            const cutHeight = Math.floor(file.height / maxCutsY);
            // Calculate precise top-left corner
            const cutLeft = x * cutWidth;
            const cutTop = y * cutHeight;

            // Adjust width/height for the last column/row to avoid exceeding image bounds due to flooring
            const adjustedWidth = (x === maxCutsX - 1) ? file.width - cutLeft : cutWidth;
            const adjustedHeight = (y === maxCutsY - 1) ? file.height - cutTop : cutHeight;


            const cutPosition: CutPosition = {
                x, y,
                maxCutsX, maxCutsY,
                width: adjustedWidth, // Use adjusted dimensions
                height: adjustedHeight,
                left: cutLeft,
                top: cutTop,
            };

            try {
                logger.debug(`Cutting file ${file.localFilePath} at ${x}x${y}`, { cutPosition });

                // Cut the image using the model function - passing the file object which now includes imageBytes
                const partialImageBytes: Buffer = await imageModel.cutImage(file, cutPosition);
                logger.debug(`Cut part ${partCounter} resulted in ${partialImageBytes.length} bytes`);

                // Call the handler with the cut image bytes and position
                await subImageHandler(partialImageBytes, cutPosition, file.file_id, file.filename);

                logger.info(`splitIn9ImagesAndDetect: Finished processing part ${partCounter} (x=${x}, y=${y})`);

            } catch (partError) {
                // Log error for the specific part but continue processing others
                logger.error(`splitIn9ImagesAndDetect: Error processing part ${partCounter} (x=${x}, y=${y})`, { error: partError, cutPosition });
                // Depending on requirements, you might want to:
                // - Stop processing entirely: throw partError;
                // - Mark the overall job as failed later (e.g., by returning a status or throwing after the loop)
            }
        }
    }
    logger.info(`splitIn9ImagesAndDetect: Finished processing all ${totalParts} parts for file_id ${file.file_id}.`);
    // Removed commented-out Redis publishing logic
}


export async function retryAsyncFunction(asyncFunction: () => Promise<any>, maxRetries: number, DELAY_SEC = 60): Promise<any> {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            return await asyncFunction();
        } catch (error) {
            logger.warn(`Attempt ${retries + 1} failed`);
            logger.error(error);
            retries++;
            if (retries < maxRetries) {
                await sleep(DELAY_SEC)
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
    // Input validation
    if (typeof num !== 'number' || isNaN(num) || typeof decimalPlaces !== 'number' || !Number.isInteger(decimalPlaces) || decimalPlaces < 0) {
        logger.warn('roundToDecimal: Invalid input provided.', { num, decimalPlaces });
        // Return NaN or throw an error, depending on desired behavior for invalid input
        return NaN;
    }
    const multiplier = Math.pow(10, decimalPlaces);
    return Math.round(num * multiplier) / multiplier;
}

/**
 * Transforms relative bounding box coordinates from a sub-image (cut)
 * back into relative coordinates of the original, full-sized image.
 *
 * Assumes input coordinates (top_row, etc.) are relative (0-1) to the sub-image.
 * Assumes cutPosition contains pixel dimensions and offsets of the sub-image
 * relative to the original image.
 *
 * @param bounding_box - Object with { top_row, left_col, bottom_row, right_col } relative to sub-image.
 * @param cutPosition - Position and dimensions of the sub-image cut.
 * @returns Object with { x, y, w, h } relative to the original image, or null if input is invalid.
 */
export function transformSubImageCoordsToOriginal(
    bounding_box: { top_row: number, left_col: number, bottom_row: number, right_col: number },
    cutPosition: CutPosition
): { x: number, y: number, w: number, h: number } | null {

    // --- Input Validation ---
    if (!bounding_box || typeof bounding_box.top_row !== 'number' || typeof bounding_box.left_col !== 'number' ||
        typeof bounding_box.bottom_row !== 'number' || typeof bounding_box.right_col !== 'number') {
        logger.warn('transformSubImageCoordsToOriginal: Invalid bounding_box input.', { bounding_box });
        return null;
    }
    if (!cutPosition || typeof cutPosition.width !== 'number' || typeof cutPosition.height !== 'number' ||
        typeof cutPosition.left !== 'number' || typeof cutPosition.top !== 'number' ||
        typeof cutPosition.maxCutsX !== 'number' || typeof cutPosition.maxCutsY !== 'number' ||
        cutPosition.maxCutsX <= 0 || cutPosition.maxCutsY <= 0 || cutPosition.width <= 0 || cutPosition.height <= 0) {
        logger.warn('transformSubImageCoordsToOriginal: Invalid cutPosition input.', { cutPosition });
        return null;
    }

    const { top_row, left_col, bottom_row, right_col } = bounding_box;

    // --- Calculate dimensions and center relative to the SUB-IMAGE (0-1 range) ---
    const subImageRelH = bottom_row - top_row;
    const subImageRelW = right_col - left_col;
    // Center X relative to sub-image
    const subImageRelX = left_col + subImageRelW / 2;
    // Center Y relative to sub-image (Y increases downwards, origin top-left)
    const subImageRelY = top_row + subImageRelH / 2;

    // --- Calculate dimensions of the ORIGINAL image ---
    // Note: This assumes the cuts perfectly tile the original image.
    // If the last row/column cuts were adjusted, this might be slightly off,
    // but should be okay for relative coordinate transformation.
    const originalImageWidth = cutPosition.maxCutsX * cutPosition.width; // Width used for the majority of cuts
    const originalImageHeight = cutPosition.maxCutsY * cutPosition.height; // Height used for the majority of cuts

    // --- Transform coordinates to be relative to the ORIGINAL image ---

    // Calculate absolute pixel coordinates of the center within the original image
    const absoluteCenterX = (subImageRelX * cutPosition.width) + cutPosition.left;
    const absoluteCenterY = (subImageRelY * cutPosition.height) + cutPosition.top;

    // Convert absolute pixel center back to relative coordinates (0-1) of the original image
    const originalImageRelX = absoluteCenterX / originalImageWidth;
    const originalImageRelY = absoluteCenterY / originalImageHeight;

    // Calculate width and height relative to the original image
    // Width of bbox in pixels = subImageRelW * cutPosition.width
    // Relative width = (subImageRelW * cutPosition.width) / originalImageWidth
    // Simplified: subImageRelW / maxCutsX
    const originalImageRelW = subImageRelW / cutPosition.maxCutsX;
    const originalImageRelH = subImageRelH / cutPosition.maxCutsY;


    // --- Final Validation and Rounding ---
    // Ensure results are valid numbers before rounding
     if (isNaN(originalImageRelX) || isNaN(originalImageRelY) || isNaN(originalImageRelW) || isNaN(originalImageRelH)) {
        logger.warn('transformSubImageCoordsToOriginal: Calculation resulted in NaN.', {
            bounding_box, cutPosition, originalImageRelX, originalImageRelY, originalImageRelW, originalImageRelH
        });
        return null;
    }

    return {
        x: roundToDecimal(originalImageRelX, 5),
        y: roundToDecimal(originalImageRelY, 5),
        h: roundToDecimal(originalImageRelH, 4),
        w: roundToDecimal(originalImageRelW, 4),
    };
}
