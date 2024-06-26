import fs from 'fs';
import crypto from 'crypto';

import { parseResolveInfo, simplifyParsedResolveInfoFragmentWithType } from 'graphql-parse-resolve-info';
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
		file: async (_, { id }, { uid }) => {
			return await fileModel.getById(id, uid)
		},
		hiveFiles: async (_, { hiveId }, { uid }) => {
			return fileModel.getByHiveId(hiveId, uid)
		},
		getExistingHiveAdvice: (_, { hiveID }, { uid }) => {
			return beekeeper.getAdvice(hiveID, uid)
		},
		hiveFrameSideFile: async (_, { frameSideId }, { uid }) => {
			return frameSideModel.getLastestByFrameSideId(frameSideId, uid)
		},
		hiveFrameSideCells: async (_, { frameSideId }, { uid }, info) => {
			return frameSideCellsModel.getByFrameSideId(frameSideId, uid, getRequestedParams(info))
		},
		// Loads all frame sides for a particular past inspection
		frameSidesInspections: async (_, { frameSideIds, inspectionId }, { uid }) => {
			if (!uid) {
				logger.error('Attempt to access frameSidesInspections without uid', { frameSideIds, inspectionId })
				return []
			}
			return frameSideModel.getFrameSides(frameSideIds, inspectionId, uid)
		}
	},
	Hive: {
		files: async (hive, _, { uid }) => {
			return fileModel.getByHiveId(hive.id, uid);
		},
		beeCount: async (hive, _, { uid }) => {
			return fileModel.countAllBees(hive.id, uid);
		}
	},
	File: {
		__resolveReference: async ({ id }, { uid }) => {
			return fileModel.getById(id, uid)
		},
		resizes: async ({ id }, __, { uid }) => {
			return await fileResizeModel.getResizes(id, uid)
		}
	},
	FrameSide: {
		__resolveReference: async ({ id }, { uid }) => {
			return {
				__typename: 'FrameSide',
				id,
				frameSideId: id
			};
		},

		file: async ({ id }, __, { uid }) => {
			return await fileModel.getByFrameSideId(id, uid)
		},
		cells: async (parent, __, { uid }, info) => {
			let frameSideId = parent.frameSideId ? parent.frameSideId : parent.id
			return await frameSideCellsModel.getByFrameSideId(frameSideId, uid, getRequestedParams(info))
		},

		frameSideFile: async ({ frameSideId }, __, { uid }) => {
			return ({ frameSideId })
		}
	},
	FrameSideInspection: {
		file: async ({ frameSideId, inspectionId }, __, { uid }) => {
			return await fileModel.getByFrameSideAndInspectionId(frameSideId, inspectionId, uid)
		},
		cells: async ({ frameSideId, inspectionId }, __, { uid }) => {
			return await frameSideCellsModel.getByFrameSideAndInspectionId(frameSideId, inspectionId, uid)
		},
		frameSideFile: async ({ frameSideId }, __, { uid }) => {
			return ({ frameSideId })
		}
	},
	FrameSideFile: {
		queenDetected: async (parent, _, { uid }) => {
			return frameSideModel.isQueenDetected(parent.frameSideId, uid)
		},
		isBeeDetectionComplete: async (parent, _, { uid }) => {
			return frameSideModel.isComplete(parent.frameSideId, uid)
		},
		isCellsDetectionComplete: async (parent, _, { uid }) => {
			return frameSideCellsModel.isComplete(parent.frameSideId, uid)
		},
		isQueenCupsDetectionComplete: async (parent, _, { uid }) => {
			return frameSideQueenCupsModel.isComplete(parent.frameSideId, uid)
		},

		// todo add caching or dedicated column around this
		detectedBees: async (parent, _, { uid }) => {
			return frameSideModel.getDetectedBeesAndQueensFromLatestFile(parent.frameSideId, uid)
		},
		detectedVarroa: async (parent, _, { uid }) => {
			return frameSideModel.getDetectedVarroa(parent.frameSideId, uid)
		},
		detectedCells: async (parent, _, { uid }) => {
			return frameSideModel.getDetectedCells(parent.frameSideId, uid)
		},
		detectedQueenCount: async (parent, _, { uid }) => {
			return frameSideModel.getQueenCount(parent.frameSideId, uid)
		},
		varroaCount: async (parent, _, { uid }) => {
			return frameSideModel.getVarroaCount(parent.frameSideId, uid)
		},
		detectedWorkerBeeCount: async (parent, _, { uid }) => {
			return frameSideModel.getWorkerBeeCount(parent.frameSideId, uid)
		},
		detectedDroneCount: async (parent, _, { uid }) => {
			return frameSideModel.getDroneCount(parent.frameSideId, uid)
		},
	},
	Mutation: {
		cloneFramesForInspection: async (_, { frameSideIDs, inspectionId }, { uid }) => {
			await frameSideModel.cloneFramesForInspection(frameSideIDs, inspectionId, uid);
			await frameSideCellsModel.cloneFramesForInspection(frameSideIDs, inspectionId, uid);
			await frameSideQueenCupsModel.cloneFramesForInspection(frameSideIDs, inspectionId, uid);

			return true
		},
		generateHiveAdvice: async (_, { hiveID, adviceContext, langCode = 'en' }, { uid }) => {
			langCode = langCode.substring(0, 2) // avoid injections
			const question = beekeeper.generatePrompt(langCode, adviceContext)
			const answer = await beekeeper.generateHiveAdvice(question)
			beekeeper.insert(uid, hiveID, question, answer)
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
				
				
				const tmpResizeFile1024 = `${rootPath}tmp/${uid}_${filename}_1024`
				const tmpResizeFile512 = `${rootPath}tmp/${uid}_${filename}_512`
				const tmpResizeFile128 = `${rootPath}tmp/${uid}_${filename}_128`

				// 3 heavier jobs to run in parallel
				const originalResult = await upload(tmpLocalFile, `${uid}/${hash}/original${ext ? "." + ext : ''}`)

				await imageModel.resizeImage(tmpLocalFile, tmpResizeFile1024, 1024, 70),
				await upload(tmpResizeFile1024, `${uid}/${hash}/1024${ext ? "." + ext : ''}`)
				
				await imageModel.resizeImage(tmpResizeFile1024, tmpResizeFile512, 512, 70)
				await upload(tmpResizeFile512, `${uid}/${hash}/512${ext ? "." + ext : ''}`)

				await imageModel.resizeImage(tmpResizeFile512, tmpResizeFile128, 128, 70)
				await upload(tmpResizeFile128, `${uid}/${hash}/128${ext ? "." + ext : ''}`)

				fs.unlinkSync(tmpResizeFile1024);
				fs.unlinkSync(tmpResizeFile512);
				fs.unlinkSync(tmpResizeFile128);


				// cleanup original after resizes are complete
				fs.unlinkSync(tmpLocalFile);

				// db
				const id = await fileModel.insert(
					uid,
					filename,
					ext,
					hash,
					dimensions.width,
					dimensions.height
				);

				await fileResizeModel.insertResize(id, 128);
				await fileResizeModel.insertResize(id, 512);
				await fileResizeModel.insertResize(id, 1024);
				

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
			return true
		}
	},
	Upload: GraphQLUpload,
}

function getRequestedParams(info: any): string[] {
	const { fields } = simplifyParsedResolveInfoFragmentWithType(
		//@ts-ignore
		parseResolveInfo(info),
		info.returnType
	);

	// collect field names
	let fieldsRequested = [];
	for (let field in fields) {
		if (field !== '__typename') {
			//@ts-ignore
			fieldsRequested.push(field?.name);
		}
	}
	return fieldsRequested;
}

