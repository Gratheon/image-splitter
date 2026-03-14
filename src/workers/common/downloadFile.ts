// @ts-ignore
import Jimp from 'jimp';
// @ts-ignore
import fs from 'fs';
// @ts-ignore
import http from 'http';
// @ts-ignore
import https from 'https';
import sharp from 'sharp';

import URL from '../../url'

import { logger } from '../../logger';
import fileModel from '../../models/file';
import {Path} from "../../path";
import config from "../../config";

async function downloadFile(url: URL, localPath: Path) {
	return new Promise((resolve, reject) => {
		const uniqueSuffix = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
		const tempPath = `${localPath}.${uniqueSuffix}.download`;
		let settled = false;
		const cleanupAndReject = (error: unknown) => {
			if (settled) {
				return;
			}
			settled = true;
			try {
				if (fs.existsSync(tempPath)) {
					fs.unlinkSync(tempPath);
				}
			} catch (cleanupError) {
				logger.warn('Failed to cleanup temp download file', { tempPath, cleanupError });
			}
			reject(error);
		};

		try {
			const file = fs.createWriteStream(tempPath);
			const p = url.startsWith("https") ? https : http;
			const request = p.get(url, function (response) {
				if (!response.statusCode || response.statusCode >= 400) {
					cleanupAndReject(new Error(`Failed to download file. HTTP status: ${response.statusCode}`));
					return;
				}

				response.on('error', cleanupAndReject);
				file.on('error', cleanupAndReject);

				response.pipe(file);

				file.on("finish", () => {
					file.close((closeError) => {
						if (closeError) {
							cleanupAndReject(closeError);
							return;
						}
						try {
							fs.renameSync(tempPath, localPath);
							if (!settled) {
								settled = true;
								logger.info("Download Completed");
								resolve(true);
							}
						} catch (renameError) {
							cleanupAndReject(renameError);
						}
					});
				});
			});

			request.on('error', cleanupAndReject);
		} catch (e) {
			cleanupAndReject(e);
		}
	});
}

async function isImageReadable(localPath: Path, expectedWidth?: number, expectedHeight?: number): Promise<boolean> {
	try {
		const stats = await fs.promises.stat(localPath);
		if (!stats.isFile() || stats.size === 0) {
			return false;
		}

		const metadata = await sharp(localPath).metadata();
		if (expectedWidth && expectedHeight) {
			if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
				logger.warn('Existing local file dimensions do not match expected dimensions', {
					localPath,
					expectedWidth,
					expectedHeight,
					actualWidth: metadata.width,
					actualHeight: metadata.height,
				});
				return false;
			}
		}
		return true;
	} catch (error) {
		logger.warn('Existing local file is not a readable image', { localPath, error });
		return false;
	}
}

export async function downloadS3FileToLocalTmp(file: any) {
	if (fs.existsSync(file.localFilePath)) {
		const fileIsReadable = await isImageReadable(file.localFilePath, file.width, file.height);
		if (fileIsReadable) {
			logger.info(`file already exists ${file.localFilePath}`);
			return;
		}
		logger.warn(`existing local file is invalid, re-downloading ${file.localFilePath}`);
		fs.unlinkSync(file.localFilePath);
	}

	// this is a hack
	// to download file from minio in dev/test envs we need to replace localhost with minio
	// because docker container can't download from localhost, it thinks of itself as that
	if(process.env.ENV_ID === 'testing' || process.env.ENV_ID === 'dev') {
		file.url = file.url.replace(
			config.aws.url.public,
			`${config.aws.target_upload_endpoint}${config.aws.bucket}/`
		);
	}

	logger.info(`downloading ${file.url} -> ${file.localFilePath}`);

	await downloadFile(file.url, file.localFilePath);
	logger.info(`download complete ${file.url} -> ${file.localFilePath}`);
}

export async function sleep(sec = 1) {
	// slow down API for security to slow down brute-force
	await new Promise(resolve => setTimeout(resolve, sec * 1000));
}
