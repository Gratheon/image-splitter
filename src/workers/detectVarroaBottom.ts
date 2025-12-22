import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

import config from '../config';
import { logger } from '../logger';
import boxFileModel from '../models/boxFile';
import { downloadS3FileToLocalTmp } from './common/downloadFile';
import { generateChannelName, publisher } from '../redisPubSub';
import * as imageModel from '../models/image';

export async function detectVarroaBottom(fileId: number, payload: any) {
    const boxFile = await boxFileModel.getBoxFileByFileId(fileId);

    if (!boxFile) {
        throw new Error(`Box file ${fileId} not found`);
    }

    logger.info('detectVarroaBottom - processing file', {
        fileId,
        boxId: boxFile.box_id,
        userId: boxFile.user_id
    });

    const fileToDownload = {
        file_id: fileId,
        user_id: boxFile.file_user_id,
        hash: boxFile.hash,
        filename: boxFile.filename,
        url_version: 1,
        url: boxFile.url,
        localFilePath: imageModel.getOriginalFileLocalPath(boxFile.file_user_id, boxFile.filename)
    };

    await downloadS3FileToLocalTmp(fileToDownload);

    try {
        const crypto = require('crypto');
        const fileBuffer = fs.readFileSync(fileToDownload.localFilePath);
        const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        const fileStats = fs.statSync(fileToDownload.localFilePath);

        logger.info('detectVarroaBottom - sending file to model', {
            fileId,
            localFilePath: fileToDownload.localFilePath,
            fileSizeBytes: fileStats.size,
            fileSizeMB: (fileStats.size / 1024 / 1024).toFixed(2),
            fileHash: fileHash.substring(0, 16),
            modelUrl: config.models.varroaBottomUrl
        });

        const formData = new FormData();
        formData.append('file', fileBuffer, {
            filename: boxFile.filename || 'image.jpg',
            contentType: 'image/jpeg'
        });

        const response = await axios.post(
            config.models.varroaBottomUrl,
            formData,
            {
                headers: {
                    ...formData.getHeaders()
                },
                timeout: 120000
            }
        );

        const { count, result } = response.data;
        const varroaCount = count ?? result?.length ?? 0;

        logger.info('detectVarroaBottom - received response', {
            fileId,
            count: varroaCount,
            detectionsCount: result?.length || 0,
            message: response.data.message,
            sampleDetection: result?.[0] || null
        });

        const detections = result?.map(d => ({
            x: (d.x1 + d.x2) / 2,
            y: (d.y1 + d.y2) / 2,
            width: d.x2 - d.x1,
            height: d.y2 - d.y1,
            confidence: d.confidence
        })) || [];

        await boxFileModel.updateVarroaDetections(
            fileId,
            boxFile.box_id,
            boxFile.user_id,
            varroaCount,
            detections
        );

        publisher().publish(
            generateChannelName(
                boxFile.user_id,
                'box',
                boxFile.box_id,
                'varroa_detected'
            ),
            JSON.stringify({
                fileId,
                boxId: boxFile.box_id,
                varroaCount: varroaCount,
                detections,
                isComplete: true
            })
        );

        logger.info('detectVarroaBottom - complete', {
            fileId,
            boxId: boxFile.box_id,
            count: varroaCount
        });

        if (fs.existsSync(fileToDownload.localFilePath)) {
            fs.unlinkSync(fileToDownload.localFilePath);
        }

    } catch (error) {
        const err = error as Error;
        logger.error('detectVarroaBottom - error', {
            fileId,
            error: err.message,
            stack: err.stack
        });

        if (fs.existsSync(fileToDownload.localFilePath)) {
            fs.unlinkSync(fileToDownload.localFilePath);
        }

        throw error;
    }
}

