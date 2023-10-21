import fs from 'fs';
import crypto from 'crypto';

import { GraphQLUpload } from 'graphql-upload';
import { finished } from 'stream/promises';

import { logger } from '../logger';
import upload from '../models/s3';
import fileModel from '../models/file';
import fileResizeModel from '../models/fileResize';
import * as imageModel from '../models/image';

import frameSideFileModel from '../models/frameSide';
import frameSideCells from '../models/frameSideCells';
import frameSideQueenCupsModel from '../models/frameSideQueenCups';
import frameSideModel from '../models/frameSide';

export const resolvers = {
	Query: {
		file: async (_, { id }, ctx) => {
			return await fileModel.getById(id, ctx.uid)
		},
		hiveFiles: async (_, { hiveId }, ctx) => {
			return fileModel.getByHiveId(hiveId, ctx.uid)
		},
		// hiveFrameSide: async (_, { frameSideId }, ctx) => {
		// 	return frameSideModel.getByFrameSideId(frameSideId, ctx.uid)
		// },
		hiveFrameSideFile: async (_, { frameSideId }, ctx) => {
			return frameSideFileModel.getByFrameSideId(frameSideId, ctx.uid)
		},
		hiveFrameSideCells: async (_, { frameSideId }, ctx) => {
			return frameSideCells.getByFrameSideId(frameSideId, ctx.uid)
		},
	},
	Hive: {
		files: async (hive, _, ctx) => {
			return fileModel.getByHiveId(hive.id, ctx.uid);
		},
		beeCount: async (hive, _, ctx) => {
			return fileModel.countAllBees(hive.id, ctx.uid);
		}
	},
	File: {
		__resolveReference: async ({ id }, ctx) => {
			return fileModel.getById(id, ctx.uid)
		},
		resizes: async ({ id }, __, ctx) => {
			return await fileResizeModel.getResizes(id, ctx.uid)
		}
	},
	FrameSide: {
		__resolveReference: async ({ id }, ctx) => {
			return {
				__typename: 'FrameSide',
				id,
				frameSideId: id
			};
		},

		file: async ({ id }, __, ctx) => {
			return await fileModel.getByFrameSideId(id, ctx.uid)
		},
		cells: async (parent, __, ctx) => {
			return await frameSideCells.getByFrameSideId(parent.frameSideId, ctx.uid)
		},
	},

	FrameSideFile: {
		isBeeDetectionComplete: async (parent, _, ctx) => {
			return frameSideFileModel.isComplete(parent.frameSideId, ctx.uid)
		},
		isCellsDetectionComplete: async (parent, _, ctx) => {
			return frameSideCells.isComplete(parent.frameSideId, ctx.uid)
		},
		isQueenCupsDetectionComplete: async (parent, _, ctx) => {
			return frameSideQueenCupsModel.isComplete(parent.frameSideId, ctx.uid)
		},

		// todo add caching or dedicated column around this
		detectedBees: async (parent, _, ctx) => {
			return frameSideFileModel.getDetectedBees(parent.frameSideId, ctx.uid)
		},
		detectedQueenCount: async (parent, _, ctx) => {
			return frameSideFileModel.getQueenCount(parent.frameSideId, ctx.uid)
		},
		detectedWorkerBeeCount: async (parent, _, ctx) => {
			return frameSideFileModel.getWorkerBeeCount(parent.frameSideId, ctx.uid)
		},
		detectedDroneCount: async (parent, _, ctx) => {
			return frameSideFileModel.getDroneCount(parent.frameSideId, ctx.uid)
		},
	},


	Mutation: {
		addFileToFrameSide: async (_, { frameSideId, fileId, hiveId }, { uid }) => {
			await fileModel.addFrameRelation(fileId, frameSideId, uid);
			await frameSideCells.addFrameCells(fileId, frameSideId, uid);
			await frameSideQueenCupsModel.addFrameCups(fileId, frameSideId, uid);

			await fileModel.addHiveRelation(fileId, hiveId, uid);
			return true
		},
		uploadFrameSide: async (_, { file }, { uid }) => {
			try {
				// local file
				const { createReadStream, filename, mimetype, encoding } = await file;
				const stream = createReadStream();
				const tmpLocalFile = `tmp/${uid}_${filename}`
				const out = fs.createWriteStream(tmpLocalFile);
				stream.pipe(out);
				await finished(out);

				const dimensions = imageModel.getImageSize(tmpLocalFile);

				// hash
				const fileBuffer = fs.readFileSync(tmpLocalFile);
				const hashSum = crypto.createHash('sha256');
				hashSum.update(fileBuffer);
				const hash = hashSum.digest('hex')

				const ext = fileModel.getFileExtension(filename)

				// resize
				const tmpResizeFile = `tmp/${uid}_${filename}_1024`
				await imageModel.resizeImage(tmpLocalFile, tmpResizeFile, 1024, 70)

				// AWS
				const [originalResult] = await Promise.all([
					upload(tmpLocalFile, `${uid}/${hash}/original${ext ? "." + ext : ''}`),
					upload(tmpResizeFile, `${uid}/${hash}/1024${ext ? "." + ext : ''}`)
				]);

				// db
				const id = await fileModel.insert(
					uid,
					filename,
					ext,
					hash,
					dimensions.width,
					dimensions.height
				);

				// for accounting
				await fileResizeModel.insertResize(id);

				logger.info('uploaded original and resized version', { filename });
				logger.info('File uploaded to S3');
				logger.info(originalResult);

				return {
					id,
					url: originalResult.Location,
					sizes: fileResizeModel.getResizes(id, uid)
				}

			} catch (err) {
				console.error(err);
			}
		},

		filesStrokeEditMutation: async (_, { files }, { uid }) => {
			return await fileModel.updateStrokes(files, uid);
		},

		updateFrameSideCells: async (_, { cells }, { uid }) => {
			await frameSideCells.updateRelativeCells(cells, uid, cells.id);
			console.log('updateFrameSideFile called', cells)
			return true
		}
	},
	Upload: GraphQLUpload,
}
