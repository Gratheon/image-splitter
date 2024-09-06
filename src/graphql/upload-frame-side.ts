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

import config from "../config";
import {ResizeJobPayload} from "../workers/common/resizeOriginalToThumbnails";

export default async function uploadFrameSide (_, {file}, {uid}) {
    if (!uid) {
        logger.error('Attempt to upload file without uid')
        return null
    }

    try {
        // local file
        let {createReadStream, filename, mimetype, encoding} = await file;

        logger.info("received file", {filename})
        const stream = createReadStream();
        let tmpLocalFile = `${config.rootPath}tmp/${uid}_${filename}`

        // copy stream to tmp folder
        const out = fs.createWriteStream(tmpLocalFile);
        stream.pipe(out);
        await finished(out);

        // convert webp to jpg because jimp does not handle webp
        if (mimetype === 'image/webp') {
            const webpFilePath = tmpLocalFile;
            const jpgFilePath = tmpLocalFile.replace('.webp', '.jpg');
            filename = filename.replace('.webp', '.jpg');
            const result = await imageModel.convertWebpToJpg(webpFilePath, jpgFilePath);
            logger.info('converted webp to jpg', {uid, filename, result});
            tmpLocalFile = jpgFilePath;

            // delete webp
            fs.unlinkSync(webpFilePath);
        }

        const dimensions = imageModel.getImageSize(tmpLocalFile);

        // hash
        const fileBuffer = fs.readFileSync(tmpLocalFile);
        const hashSum = crypto.createHash('sha256');
        hashSum.update(fileBuffer);
        const hash = hashSum.digest('hex')

        let ext = fileModel.getFileExtension(filename)


        // const tmpResizeFile1024 = `${rootPath}tmp/${uid}_1024_${filename}`
        // const tmpResizeFile512 = `${rootPath}tmp/${uid}_512_${filename}`
        // const tmpResizeFile128 = `${rootPath}tmp/${uid}_128_${filename}`

        // 3 heavier jobs to run in parallel
        const originalResult = await upload(tmpLocalFile, `${uid}/${hash}/original${ext ? "." + ext : ''}`)

        const id = await fileModel.insert(
            uid,
            filename,
            ext,
            hash,
            dimensions.width,
            dimensions.height
        );

        // define map
        // let resizeMap: imageModel.SizePath[] = []
        // resizeMap.push([1024, tmpResizeFile1024])
        // resizeMap.push([512, tmpResizeFile512])
        // resizeMap.push([128, tmpResizeFile128])
        //
        //
        // let resultMap = await imageModel.resizeImages(tmpLocalFile, resizeMap)
        // console.log({resultMap})
        //
        // if (resultMap !== null) {
        //     for await (let [maxDimension, outputPath] of resultMap) {
        //         await upload(outputPath, `${uid}/${hash}/${maxDimension}${ext ? "." + ext : ''}`)
        //         await fileResizeModel.insertResize(id, maxDimension);
        //         fs.unlinkSync(outputPath)
        //     }
        // }

        // cleanup original after resizes are complete
        // fs.unlinkSync(tmpLocalFile);

        logger.info('uploaded original and resized version', {uid, filename});
        logger.info('File uploaded to S3', {uid, originalResult});

        let resizePayload: ResizeJobPayload = {
            file_id: id,
            uid,
            filename,
            hash,
            ext
        }
        await jobs.addJob(TYPE_RESIZE, id, resizePayload);
        await jobs.addJob(TYPE_BEES, id);
        await jobs.addJob(TYPE_CELLS, id);
        await jobs.addJob(TYPE_CUPS, id);
        await jobs.addJob(TYPE_QUEENS, id);
        await jobs.addJob(TYPE_VARROA, id);

        return {
            id,
            url: originalResult,
            resizes: await fileResizeModel.getResizes(id, uid)
        }

    } catch (err) {
        logger.error(err);
        console.error(err);
    }
}