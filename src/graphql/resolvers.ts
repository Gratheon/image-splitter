import fs from 'fs';
import crypto from 'crypto';

import { GraphQLUpload } from 'graphql-upload';
import { finished } from 'stream/promises';

import { logger } from '../logger';
import upload from '../models/s3';
import fileModel from '../models/file';
import fileResizeModel from '../models/fileResize';
import * as imageModel from '../models/image';

import frameSideModel from '../models/frameSide';
import frameSideCellsModel from '../models/frameSideCells';
import frameSideQueenCupsModel from '../models/frameSideQueenCups';
import beekeeper from '../models/ai-beekeeper';

export const resolvers = {
	Query: {
		file: async (_, { id }, ctx) => {
			return await fileModel.getById(id, ctx.uid)
		},
		hiveFiles: async (_, { hiveId }, ctx) => {
			return fileModel.getByHiveId(hiveId, ctx.uid)
		},
		hiveFrameSideFile: async (_, { frameSideId }, ctx) => {
			return frameSideModel.getLastestByFrameSideId(frameSideId, ctx.uid)
		},
		hiveFrameSideCells: async (_, { frameSideId }, ctx) => {
			return frameSideCellsModel.getByFrameSideId(frameSideId, ctx.uid)
		},
		getExistingHiveAdvice: (_, { hiveID }, ctx) => {
			return beekeeper.getAdvice(hiveID, ctx.uid)
		}
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
			return await frameSideCellsModel.getByFrameSideId(parent.frameSideId, ctx.uid)
		},

		frameSideFile: async (parent, __, ctx) => {
			return ({ frameSideId: parent.frameSideId })
		}
	},
	FrameSideFile: {
		queenDetected: async (parent, _, ctx) => {
			return frameSideModel.isQueenDetected(parent.frameSideId, ctx.uid)
		},
		isBeeDetectionComplete: async (parent, _, ctx) => {
			return frameSideModel.isComplete(parent.frameSideId, ctx.uid)
		},
		isCellsDetectionComplete: async (parent, _, ctx) => {
			return frameSideCellsModel.isComplete(parent.frameSideId, ctx.uid)
		},
		isQueenCupsDetectionComplete: async (parent, _, ctx) => {
			return frameSideQueenCupsModel.isComplete(parent.frameSideId, ctx.uid)
		},

		// todo add caching or dedicated column around this
		detectedBees: async (parent, _, ctx) => {
			return frameSideModel.getDetectedBeesAndQueensFromLatestFile(parent.frameSideId, ctx.uid)
		},
		detectedVarroa: async (parent, _, ctx) => {
			return frameSideModel.getDetectedVarroa(parent.frameSideId, ctx.uid)
		},
		detectedCells: async (parent, _, ctx) => {
			return frameSideModel.getDetectedCells(parent.frameSideId, ctx.uid)
		},
		detectedQueenCount: async (parent, _, ctx) => {
			return frameSideModel.getQueenCount(parent.frameSideId, ctx.uid)
		},
		varroaCount: async (parent, _, ctx) => {
			return frameSideModel.getVarroaCount(parent.frameSideId, ctx.uid)
		},
		detectedWorkerBeeCount: async (parent, _, ctx) => {
			return frameSideModel.getWorkerBeeCount(parent.frameSideId, ctx.uid)
		},
		detectedDroneCount: async (parent, _, ctx) => {
			return frameSideModel.getDroneCount(parent.frameSideId, ctx.uid)
		},
	},
	Mutation: {
		cloneFramesForInspection: async (_, { frameSideIDs, inspectionId }, ctx) => {
			await frameSideModel.cloneFramesForInspection(frameSideIDs, inspectionId, ctx.uid);
			await frameSideCellsModel.cloneFramesForInspection(frameSideIDs, inspectionId, ctx.uid);
			await frameSideQueenCupsModel.cloneFramesForInspection(frameSideIDs, inspectionId, ctx.uid);

			return true
		},
		generateHiveAdvice: async (_, { hiveID, adviceContext, langCode = 'en' }, ctx) => {
			langCode = langCode.substring(0, 2) // avoid injections
			const question = beekeeper.generatePrompt(langCode, adviceContext)
			const answer = await beekeeper.generateHiveAdvice(question)
			beekeeper.insert(ctx.uid, hiveID, question, answer)
			return answer
		},
		addFileToFrameSide: async (_, { frameSideId, fileId, hiveId }, { uid }) => {
			await fileModel.addFrameRelation(fileId, frameSideId, uid);
			await frameSideCellsModel.addFrameCells(fileId, frameSideId, uid);
			await frameSideQueenCupsModel.addFrameCups(fileId, frameSideId, uid);

			await fileModel.addHiveRelation(fileId, hiveId, uid);
			return true
		},
		uploadFrameSide: async (_, { file }, { uid }) => {
			const rootPath = '/app/'
			try {
				// local file
				let { createReadStream, filename, mimetype, encoding } = await file;
				const stream = createReadStream();
				let tmpLocalFile = `${rootPath}tmp/${uid}_${filename}`

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
					logger.info('converted webp to jpg', { uid, filename, result });
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

				// resize
				const tmpResizeFile = `${rootPath}tmp/${uid}_${filename}_1024`
				await imageModel.resizeImage(tmpLocalFile, tmpResizeFile, 1024, 70)

				// AWS
				const [originalResult] = await Promise.all([
					upload(tmpLocalFile, `${uid}/${hash}/original${ext ? "." + ext : ''}`),
					upload(tmpResizeFile, `${uid}/${hash}/1024${ext ? "." + ext : ''}`)
				]);

				// cleanup
				fs.unlinkSync(tmpLocalFile);
				fs.unlinkSync(tmpResizeFile);


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

				logger.info('uploaded original and resized version', { uid, filename });
				logger.info('File uploaded to S3', { uid, originalResult });

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
			return await frameSideModel.updateStrokes(files, uid);
		},

		updateFrameSideQueenPresense: async (_, { frameSideId, isPresent }, { uid }) => {
			return await frameSideModel.updateFrameSideQueenPresense(frameSideId, isPresent, uid);
		},

		updateFrameSideCells: async (_, { cells }, { uid }) => {
			await frameSideCellsModel.updateRelativeCells(cells, uid, cells.id);
			console.log('updateFrameSideFile called', cells)
			return true
		}
	},
	Upload: GraphQLUpload,
}

