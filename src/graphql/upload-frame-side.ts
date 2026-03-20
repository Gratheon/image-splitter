// @ts-ignore
import crypto from "crypto";
// @ts-ignore
import fs from "fs";
import path from "path";
import {finished} from "stream/promises";

import {logger} from "../logger";

import * as imageModel from "../models/image";
import fileModel from "../models/file";
import upload from "../models/s3";
import fileResizeModel from "../models/fileResize";
import jobs, {TYPE_RESIZE} from "../models/jobs";
import {ResizeJobPayload} from "../workers/common/resizeOriginalToThumbnails";

// 10 min should be enough to process the file
const DELETE_UPLOADED_FILE_AFTER_MS = 1000 * 60 * 10;

import { GraphQLError } from 'graphql'; // Import GraphQLError

function requireUid(uid: string | undefined) {
    if (!uid) {
        logger.error('Attempt to upload file without uid');
        const error = new GraphQLError('Authentication required');
        (error.extensions as any) = { code: 'UNAUTHENTICATED' };
        throw error;
    }
}

function sanitizePathSegment(value: string) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

async function uploadImageAsset(file: Promise<any>, uid: string, folderPrefix: string, errorContext: string) {
    try {
        // local file
        let {createReadStream, filename, mimetype} = await file;

        logger.info("received file", {filename, folderPrefix})
        const stream = createReadStream();
        const uploadTempKey = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        let tmpLocalFilePath = imageModel.getOriginalFileLocalPath(uid, filename, uploadTempKey)

        // store original file to disk to be reused later on by workers
        const out = fs.createWriteStream(tmpLocalFilePath);
        stream.pipe(out);
        await finished(out);

        const originalExtension = path.extname(filename).toLowerCase();
        const isWebp = mimetype === 'image/webp' || originalExtension === '.webp';

        // convert webp to jpg because downstream processing expects jpg-compatible files
        if (isWebp) {
            const webpFilePath = tmpLocalFilePath;
            const parsed = path.parse(filename);
            const normalizedFilename = `${parsed.name}.jpg`;
            const jpgFilePath = imageModel.getOriginalFileLocalPath(uid, normalizedFilename, uploadTempKey);

            await imageModel.convertWebpToJpg(webpFilePath, jpgFilePath);
            if (!fs.existsSync(jpgFilePath)) {
                throw new Error(`WebP conversion failed, output file is missing: ${jpgFilePath}`);
            }

            filename = normalizedFilename;
            logger.info('converted webp to jpg', {uid, filename, webpFilePath, jpgFilePath});
            tmpLocalFilePath = jpgFilePath;

            // delete webp
            fs.unlinkSync(webpFilePath);
        }

        const stats = fs.statSync(tmpLocalFilePath);
        const fileSizeInMB = stats.size / (1024 * 1024);

        logger.info('Processing file', { filename, fileSizeInMB: fileSizeInMB.toFixed(2) });

        const dimensions = await imageModel.getImageDimensions(tmpLocalFilePath);

        let processFilePath = tmpLocalFilePath;
        if (fileSizeInMB > 5) {
            const preprocessedPath = await imageModel.preprocessLargeImage(tmpLocalFilePath);
            if (preprocessedPath) {
                logger.info('Using preprocessed image for processing', { preprocessedPath });
                processFilePath = preprocessedPath;
            } else {
                logger.warn('Preprocessing did not reduce image size, using original', { filename, fileSizeInMB });
            }
        }

        // hash - use the original file for hashing since we upload the original to S3
        const fileBuffer = fs.readFileSync(tmpLocalFilePath);
        const hashSum = crypto.createHash('sha256');
        hashSum.update(fileBuffer);
        const hash = hashSum.digest('hex')

        let ext = fileModel.getFileExtension(filename)
        const s3Prefix = folderPrefix ? `${uid}/${folderPrefix}/${hash}` : `${uid}/${hash}`
        const originalResult = await upload(tmpLocalFilePath, `${s3Prefix}/original${ext ? "." + ext : ''}`)

        const id = await fileModel.insert(
            uid,
            filename,
            ext,
            hash,
            dimensions.width,
            dimensions.height
        );
        logger.info('File uploaded to S3', {uid, filename, originalResult, s3Prefix});

        let resizePayload: ResizeJobPayload = {
            file_id: id,
            uid,
            filename,
            hash,
            ext
        }

        await jobs.addJob(TYPE_RESIZE, id, resizePayload, 1) // High priority - user is waiting

        // cleanup after 10 min
        setTimeout(() => {
            logger.info('Deleting uploaded files', {tmpLocalFilePath, processFilePath});
            if (fs.existsSync(tmpLocalFilePath)) {
                fs.unlinkSync(tmpLocalFilePath);
            }
            if (processFilePath !== tmpLocalFilePath && fs.existsSync(processFilePath)) {
                fs.unlinkSync(processFilePath);
            }
        }, DELETE_UPLOADED_FILE_AFTER_MS);

        return {
            id,
            url: originalResult,
            resizes: await fileResizeModel.getResizes(id, uid)
        }

    } catch (err) {
        console.error(`Caught error object in ${errorContext}:`, err);
        logger.error(`Error during ${errorContext}:`, err);

        let errorMessage = 'An unknown error occurred';
        if (err instanceof Error) {
            errorMessage = err.message;
        } else if (typeof err === 'string') {
            errorMessage = err;
        }
        throw new Error(`Failed to upload image: ${errorMessage}`);
    }
}

export default async function uploadFrameSide(_, {file}, {uid}) {
    requireUid(uid)
    return uploadImageAsset(file, uid, '', 'uploadFrameSide')
}

export async function uploadApiaryPhoto(_, {file, apiaryId}, {uid}) {
    requireUid(uid)
    const safeApiaryId = sanitizePathSegment(apiaryId)
    return uploadImageAsset(file, uid, `apiaries/${safeApiaryId}`, 'uploadApiaryPhoto')
}
