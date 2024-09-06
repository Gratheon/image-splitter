// @ts-ignore
import Jimp from 'jimp';
// @ts-ignore
import fs from 'fs';
// @ts-ignore
import http from 'http';
// @ts-ignore
import https from 'https';

import URL from '../../url'

import { logger } from '../../logger';
import fileModel from '../../models/file';
import {Path} from "../../path";
import config from "../../config";

async function downloadFile(url: URL, localPath: Path) {
	return new Promise((resolve, reject) => {
		try {
			const file = fs.createWriteStream(localPath);

			let p = url.startsWith("https") ? https : http;
			p.get(url, function (response) {
				response.pipe(file);

				file.on("finish", () => {
					file.close();
					logger.info("Download Completed");
					resolve(true);
				});
			});
		} catch (e) {
			reject(e);
		}
	});
}

export async function downloadS3FileToLocalTmp(file: any) {
	if (fs.existsSync(file.localFilePath)) {
		logger.info(`file already exists ${file.localFilePath}`);
	} else {
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
}

export async function sleep(sec = 1) {
	// slow down API for security to slow down brute-force
	await new Promise(resolve => setTimeout(resolve, sec * 1000));
}

