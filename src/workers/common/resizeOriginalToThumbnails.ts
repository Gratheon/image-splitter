// @ts-ignore
import fs from "fs";

import config from "../../config";

import * as imageModel from "../../models/image";
import fileResizeModel from "../../models/fileResize";
import upload from "../../models/s3";
import fileModel from "../../models/file"; // Import fileModel to get file URL
import { downloadS3FileToLocalTmp } from "./downloadFile"; // Import download function
import { logger } from "../../logger"; // Import logger

export type ResizeJobPayload = {
    file_id: string,
    uid: string,
    filename: string,
    hash: string,
    ext: string
}

export default async function resizeOriginalToThumbnails(file_id: number, { uid, filename, hash, ext }: ResizeJobPayload) {
    const tmpResizeFile1024 = `${config.rootPath}tmp/${uid}_1024_${filename}`
    const tmpResizeFile512 = `${config.rootPath}tmp/${uid}_512_${filename}`
    const tmpResizeFile128 = `${config.rootPath}tmp/${uid}_128_${filename}`

    let resizeMap: imageModel.SizePath[] = []
    resizeMap.push([1024, tmpResizeFile1024])
    resizeMap.push([512, tmpResizeFile512])
    resizeMap.push([128, tmpResizeFile128])

    // 1. Fetch file metadata to get the URL
    // We use file_id which is the ref_id passed to the job
    const fileData = await fileModel.getById(file_id, uid);
    if (!fileData) {
        logger.error(`Resize job: File not found in DB for file_id: ${file_id}, uid: ${uid}`);
        // Fail the job by throwing an error
        throw new Error(`File metadata not found for file_id ${file_id}`);
    }
    // Construct the expected temporary file path (where download will place it)
    let tmpLocalFile = imageModel.getOriginalFileLocalPath(uid, fileData.filename);

    // 2. Download the file specifically for this job
    try {
        // Construct a minimal file object for the download function
        const fileToDownload = {
            localFilePath: tmpLocalFile,
            url: fileModel.getUrl(fileData), // Get the S3 URL
            // Add other properties if downloadS3FileToLocalTmp requires them, e.g., user_id
            user_id: uid,
            filename: fileData.filename,
        };
        await downloadS3FileToLocalTmp(fileToDownload);
    } catch (downloadError) {
        logger.error(`Resize job: Failed to download file ${fileData.filename} for file_id: ${file_id}`, downloadError);
        throw downloadError; // Fail the job
    }

    // 3. Perform resizing using the downloaded file
    let resultMap: imageModel.SizePath[] | null = null; // Correct type
    try {
        resultMap = await imageModel.resizeImages(tmpLocalFile, resizeMap);
    } catch (resizeError) {
        logger.error(`Resize job: Failed to resize file ${tmpLocalFile} for file_id: ${file_id}`, resizeError);
        // Clean up the downloaded file before failing
        if (fs.existsSync(tmpLocalFile)) {
            fs.unlinkSync(tmpLocalFile);
        }
        throw resizeError; // Fail the job
    }


    // 4. Upload results and cleanup
    if (resultMap) { // Check if resultMap is not null
        for await (let [maxDimension, outputPath] of resultMap) {
            await upload(outputPath, `${uid}/${hash}/${maxDimension}${ext ? "." + ext : ''}`)
            await fileResizeModel.insertResize(file_id, maxDimension);

            // delete *resized* file
            fs.unlinkSync(outputPath);
        }
    }

    // 5. Clean up the originally downloaded file for this job
    try {
        if (fs.existsSync(tmpLocalFile)) {
            logger.info(`Resize job: Cleaning up downloaded original file: ${tmpLocalFile}`);
            fs.unlinkSync(tmpLocalFile);
        }
    } catch (cleanupError: any) { // Add type annotation for error
        // Ignore error if the file simply doesn't exist (already cleaned up)
        if (cleanupError.code !== 'ENOENT') {
            logger.error(`Resize job: Error during final cleanup of ${tmpLocalFile}`, cleanupError);
            // Optionally re-throw if other cleanup errors should fail the job,
            // but typically cleanup failure isn't critical if main task succeeded.
            // throw cleanupError;
        } else {
             logger.warn(`Resize job: Cleanup skipped, file already gone: ${tmpLocalFile}`);
        }
    }
}
