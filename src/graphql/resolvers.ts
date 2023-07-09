import fs from 'fs';
import crypto from 'crypto';

import { GraphQLUpload } from 'graphql-upload';
import { finished } from 'stream/promises';
import sizeOf from 'image-size';

import {logger} from '../logger';
import upload from '../models/s3';
import fileModel from '../models/file';
import frameSideFileModel from '../models/frameSide';

export const resolvers = {
	Query: {
		file: async (_, { id }, ctx) => {
			return fileModel.getById(id, ctx.uid)
		},
		hiveFiles: async (_, { hiveId }, ctx) => {
			return fileModel.getByHiveId(hiveId, ctx.uid)
		},
		hiveFrameSideFile: async (_, { frameSideId }, ctx) => {
			return frameSideFileModel.getByFrameSideId(frameSideId, ctx.uid)
		},
	},
	Hive: {
		files: async (hive, _, ctx) => {
			return fileModel.getByHiveId(hive.id, ctx.uid);
		}
	},
	File: {
		__resolveReference: async ({ id }, ctx) => {
			return fileModel.getById(id, ctx.uid)
		},
	},
	FrameSide: {
		file: async ({ id }, __, ctx) => {
			return fileModel.getByFrameSideId(id, ctx.uid)
		}
	},

	FrameSideFile:{
		estimatedDetectionTimeSec: async() => {
			let jobs = await frameSideFileModel.countPendingJobs()
			if (jobs == 0) {
				return 0;
			}

			let timeSec = await frameSideFileModel.getAvgProcessingTime()
			
			return jobs * timeSec
		},
		counts: async (parent, _, ctx) => {
			return frameSideFileModel.countDetectedBees(parent.detected_bees)
		},
	},
	Mutation: {
		addFileToFrameSide: async (_, { frameSideId, fileId, hiveId }, { uid }) => {
			await fileModel.addFrameRelation(fileId, frameSideId, uid);
			await fileModel.addHiveRelation(fileId, hiveId, uid);
			return ({
				estimatedDetectionTimeSec: await resolvers.FrameSideFile.estimatedDetectionTimeSec()
			})
		},
		uploadFrameSide: async (_, { file }, { uid }) => {
			try {
				// local file
				const { createReadStream, filename, mimetype, encoding } = await file;
				const stream = createReadStream();
				const out = fs.createWriteStream(`tmp/${uid}_${filename}`);
				stream.pipe(out);
				await finished(out);

				// AWS
				const result = await upload(`tmp/${uid}_${filename}`, `${uid}/${filename}`);

				// hash
				const fileBuffer = fs.readFileSync(`tmp/${uid}_${filename}`);
				const hashSum = crypto.createHash('sha256');
				hashSum.update(fileBuffer);
				const dimensions = sizeOf(`tmp/${uid}_${filename}`);

				// db
				const id = await fileModel.insert(
					uid,
					filename,
					hashSum.digest('hex'),
					dimensions.width,
					dimensions.height
				);

				logger.info('uploaded',{filename});

				return {
					id,
					url: result.Location
				}

			} catch (err) {
				console.error(err);
			}
		},

		filesStrokeEditMutation: async (_, { files }, { uid }) => {
			return await fileModel.updateStrokes(files, uid);
		}
	},
	Upload: GraphQLUpload,
}
