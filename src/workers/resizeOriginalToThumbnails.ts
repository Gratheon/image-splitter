// @ts-ignore
import fs from "fs";

import config from "../config";

import * as imageModel from "../models/image";
import fileResizeModel from "../models/fileResize";
import upload from "../models/s3";

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

    let tmpLocalFile = `${config.rootPath}tmp/${uid}_${filename}`

    let resultMap = await imageModel.resizeImages(tmpLocalFile, resizeMap)
    console.log({resultMap})

    if (resultMap !== null) {
        for await (let [maxDimension, outputPath] of resultMap) {
            await upload(outputPath, `${uid}/${hash}/${maxDimension}${ext ? "." + ext : ''}`)
            await fileResizeModel.insertResize(file_id, maxDimension);
            fs.unlinkSync(outputPath)
        }
    }
}