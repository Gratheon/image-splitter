// Load the AWS SDK for Node.js
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
// @ts-ignore
import fs from "fs";
import {S3ClientConfig} from "@aws-sdk/client-s3/dist-types/S3Client";

import config from "../config/index";
import {AbsolutePath, Path} from "../path";
import URL from "../url";
import {logger} from "../logger";

export default async function upload(sourceLocalFilePath: AbsolutePath, targetS3FilePath: Path): Promise<URL> {
    let bucketName = config.aws.bucket;
    const region = "eu-central-1"
    let awsConfig: S3ClientConfig = {
        credentials: {
            accessKeyId: config.aws.key,
            secretAccessKey: config.aws.secret,
        },
        region,
    }

    // use minio in test env
    if (process.env.ENV_ID === 'testing') {
        awsConfig.endpoint = process.env.ENDPOINT
    }

    const s3 = new S3Client(awsConfig);

    logger.info('Uploading file to S3', {sourceLocalFilePath, targetS3FilePath})
    await s3.send(
        new PutObjectCommand({
            Bucket: bucketName,
            Key: targetS3FilePath,
            Body: fs.readFileSync(sourceLocalFilePath)
        })
    );

    return `https://${bucketName}.s3.${region}.amazonaws.com/${targetS3FilePath}`
}
