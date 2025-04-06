// Load the AWS SDK for Node.js
import {
    PutObjectCommand,
    S3Client,
    HeadBucketCommand, // Import HeadBucketCommand
    CreateBucketCommand, // Import CreateBucketCommand
    NoSuchBucket // Import NoSuchBucket error type
} from "@aws-sdk/client-s3";
// @ts-ignore
import fs from "fs";
import { S3ClientConfig } from "@aws-sdk/client-s3/dist-types/S3Client";

import config from "../config/index";
import {AbsolutePath, Path} from "../path";
import URL from "../url";
import { logger } from "../logger";

// Helper function for async sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Function to get S3 client config based on environment
function getS3ClientConfig(): S3ClientConfig {
    const region = "eu-central-1";
    let awsConfig: S3ClientConfig = {
        credentials: {
            accessKeyId: config.aws.key,
            secretAccessKey: config.aws.secret,
        },
        region,
    };

    // use minio in test env
    if (process.env.ENV_ID === 'testing' || process.env.ENV_ID === 'dev') {
        awsConfig.forcePathStyle = true;
        awsConfig.endpoint = config.aws.target_upload_endpoint;
    }
    return awsConfig;
}

// Function to ensure the S3 bucket exists, creating it if necessary
export async function ensureBucketExists() {
    const bucketName = config.aws.bucket;
    const awsConfig = getS3ClientConfig();
    const s3 = new S3Client(awsConfig);

    try {
        logger.info(`Checking if bucket "${bucketName}" exists...`);
        await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
        logger.info(`Bucket "${bucketName}" already exists.`);
    } catch (error: any) {
        // Check if the error is NoSuchBucket
        if (error.name === 'NoSuchBucket' || error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
            logger.warn(`Bucket "${bucketName}" does not exist. Attempting to create...`);
            try {
                await s3.send(new CreateBucketCommand({ Bucket: bucketName }));
                logger.info(`Bucket "${bucketName}" created successfully.`);
                // Optional: Add a small delay after creation if needed
                await sleep(500);
            } catch (createError) {
                logger.error(`Failed to create bucket "${bucketName}":`, createError);
                throw createError; // Re-throw error if creation fails
            }
        } else {
            // Re-throw unexpected errors
            logger.error(`Error checking bucket "${bucketName}":`, error);
            throw error;
        }
    }
}

export default async function upload(sourceLocalFilePath: AbsolutePath, targetS3FilePath: Path): Promise<URL> {
    const bucketName = config.aws.bucket;
    const awsConfig = getS3ClientConfig(); // Use the helper function
    const s3 = new S3Client(awsConfig);

    logger.info('Uploading file to S3', { sourceLocalFilePath, targetS3FilePath });
    // Add detailed logging before the send command
    logger.info('S3 Client Config used:', awsConfig);
    logger.info('S3 PutObjectCommand params:', { Bucket: bucketName, Key: targetS3FilePath });

    const data = fs.readFileSync(sourceLocalFilePath, { flag: 'r' });

    await s3.send(
        new PutObjectCommand({
            Bucket: bucketName,
            Key: targetS3FilePath,
            Body: data
        })
    );

    return `${config.aws.url.public}${targetS3FilePath}`
    // return `https://${bucketName}.s3.${region}.amazonaws.com/${targetS3FilePath}`
}
