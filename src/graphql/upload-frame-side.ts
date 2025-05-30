// @ts-ignore
import crypto from "crypto";
// @ts-ignore
import fs from "fs";
import {finished} from "stream/promises";

import {logger} from "../logger";

import * as imageModel from "../models/image";
import fileModel from "../models/file";
import upload from "../models/s3";
import fileResizeModel from "../models/fileResize";
import jobs, {TYPE_BEES, TYPE_CELLS, TYPE_CUPS, TYPE_QUEENS, TYPE_RESIZE, TYPE_VARROA} from "../models/jobs";
import {ResizeJobPayload} from "../workers/common/resizeOriginalToThumbnails";

// 10 min should be enough to process the file
const DELETE_UPLOADED_FILE_AFTER_MS = 1000 * 60 * 10;

import { GraphQLError } from 'graphql'; // Import GraphQLError

export default async function uploadFrameSide(_, {file}, {uid}) {
    if (!uid) {
        logger.error('Attempt to upload file without uid');
        // Throw an error instead of returning null
        const error = new GraphQLError('Authentication required');
        // Assign extensions separately
        (error.extensions as any) = { code: 'UNAUTHENTICATED' };
        throw error;
    }

    try {
        // local file
        let {createReadStream, filename, mimetype, encoding} = await file;

        logger.info("received file", {filename})
        const stream = createReadStream();
        let tmpLocalFilePath = imageModel.getOriginalFileLocalPath(uid, filename)

        // store original file to disk to be reused later on by workers
        const out = fs.createWriteStream(tmpLocalFilePath);
        stream.pipe(out);
        await finished(out);

        // convert webp to jpg because jimp does not handle webp
        if (mimetype === 'image/webp') {
            const webpFilePath = tmpLocalFilePath;
            const jpgFilePath = tmpLocalFilePath.replace('.webp', '.jpg');
            filename = filename.replace('.webp', '.jpg');
            const result = await imageModel.convertWebpToJpg(webpFilePath, jpgFilePath);
            logger.info('converted webp to jpg', {uid, filename, result});
            tmpLocalFilePath = jpgFilePath;

            // delete webp
            fs.unlinkSync(webpFilePath);
        }

        const dimensions = await imageModel.getImageDimensions(tmpLocalFilePath);

        // hash
        const fileBuffer = fs.readFileSync(tmpLocalFilePath);
        const hashSum = crypto.createHash('sha256');
        hashSum.update(fileBuffer);
        const hash = hashSum.digest('hex')

        let ext = fileModel.getFileExtension(filename)

        // 3 heavier jobs to run in parallel
        const originalResult = await upload(tmpLocalFilePath, `${uid}/${hash}/original${ext ? "." + ext : ''}`)

        const id = await fileModel.insert(
            uid,
            filename,
            ext,
            hash,
            dimensions.width,
            dimensions.height
        );
        logger.info('File uploaded to S3', {uid, filename, originalResult});

        let resizePayload: ResizeJobPayload = {
            file_id: id,
            uid,
            filename,
            hash,
            ext
        }

        // add async jobs
        await Promise.all([
            jobs.addJob(TYPE_RESIZE, id, resizePayload),
            jobs.addJob(TYPE_BEES, id),
            jobs.addJob(TYPE_CELLS, id),
            jobs.addJob(TYPE_CUPS, id),
            jobs.addJob(TYPE_QUEENS, id),
            jobs.addJob(TYPE_VARROA, id)
        ])

        // cleanup after 10 min
        setTimeout(() => {
            logger.info('Deleting uploaded file', {tmpLocalFilePath});
            fs.unlinkSync(tmpLocalFilePath);
        }, DELETE_UPLOADED_FILE_AFTER_MS);

        return {
            id,
            url: originalResult,
            resizes: await fileResizeModel.getResizes(id, uid)
        }

    } catch (err) {
        // Log the full error object for better debugging in CI
        console.error('Caught error object in uploadFrameSide:', err);
        logger.error('Error during uploadFrameSide:', err); // Keep original logger call

        let errorMessage = 'An unknown error occurred';
        if (err instanceof Error) {
            errorMessage = err.message;
        } else if (typeof err === 'string') {
            errorMessage = err;
        }
        // Throw an error that GraphQL can understand
        // Consider using a more specific ApolloError subclass if appropriate
        throw new Error(`Failed to upload frame side: ${errorMessage}`);
    }
}
