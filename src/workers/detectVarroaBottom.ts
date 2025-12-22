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

        const sharp = require('sharp');
        const imageMetadata = await sharp(fileToDownload.localFilePath).metadata();
        const dimensions = {
            width: imageMetadata.width || 0,
            height: imageMetadata.height || 0
        };

        logger.info('detectVarroaBottom - original image dimensions', {
            fileId,
            width: dimensions.width,
            height: dimensions.height
        });

        const detections = result?.map((d, index) => {
            const centerX = (d.x1 + d.x2) / 2;
            const centerY = (d.y1 + d.y2) / 2;
            const width = d.x2 - d.x1;

            const normalized = {
                x: parseFloat((centerX / dimensions.width).toFixed(4)),
                y: parseFloat((centerY / dimensions.height).toFixed(4)),
                w: parseFloat((width / dimensions.width).toFixed(4)),
                c: parseFloat(d.confidence.toFixed(2))
            };

            if (index === 0) {
                logger.info('detectVarroaBottom - first detection normalization', {
                    fileId,
                    rawDetection: { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, confidence: d.confidence },
                    calculated: { centerX, centerY, width },
                    dimensions: { width: dimensions.width, height: dimensions.height },
                    normalized
                });
            }

            return normalized;
        }) || [];

        logger.info('detectVarroaBottom - normalized detections', {
            fileId,
            sampleNormalizedDetection: detections[0] || null,
            totalDetections: detections.length
        });

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

