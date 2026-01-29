import {parseResolveInfo, simplifyParsedResolveInfoFragmentWithType} from 'graphql-parse-resolve-info';
import {GraphQLUpload} from 'graphql-upload';

import {logger} from '../logger';

import fileModel from '../models/file';
import fileResizeModel from '../models/fileResize';
import frameSideModel from '../models/frameSide';
import frameSideCellsModel from '../models/frameSideCells';
import frameSideQueenCupsModel from '../models/frameSideQueenCups';
import boxFileModel from '../models/boxFile';
import beekeeper from '../models/ai-beekeeper';
import { sendPopulationMetrics } from '../models/telemetryClient';

import uploadFrameSide from "./upload-frame-side";
import jobs, {TYPE_BEES, TYPE_DRONES, TYPE_CELLS, TYPE_CUPS, TYPE_QUEENS, TYPE_VARROA, TYPE_VARROA_BOTTOM} from "../models/jobs";


export const resolvers = {
    Query: {
        hello_image_splitter: () => 'hi',
        file: async (_, {id}, {uid}) => {
            return await fileModel.getById(id, uid)
        },
        hiveFiles: async (_, {hiveId}, {uid}) => {
            return fileModel.getByHiveId(hiveId, uid)
        },
        varroaBottomDetections: async (_, {boxId, inspectionId}, {uid}) => {
            return await boxFileModel.getVarroaDetections(boxId, uid, inspectionId);
        },
        boxFiles: async (_, {boxId, inspectionId}, {uid}) => {
            const files = await boxFileModel.getBoxFiles(boxId, uid, inspectionId);
            return files.map(f => ({
                file: {
                    id: f.file_id,
                    url: f.url
                },
                boxId: f.box_id,
                hiveId: f.hive_id,
                addedTime: f.added_time
            }));
        },
        getExistingHiveAdvice: (_, {hiveID}, {uid}) => {
            return beekeeper.getAdvice(hiveID, uid)
        },
        hiveFrameSideFile: async (_, {frameSideId}, {uid}) => {
            return frameSideModel.getLastestByFrameSideId(frameSideId, uid)
        },
        hiveFrameSideCells: async (_, {frameSideId}, {uid}, info) => {
            return frameSideCellsModel.getByFrameSideId(frameSideId, uid, getRequestedParams(info))
        },
        // Loads all frame sides for a particular past inspection
        frameSidesInspections: async (_, {frameSideIds, inspectionId}, {uid}) => {
            if (!uid) {
                logger.error('Attempt to access frameSidesInspections without uid', {frameSideIds, inspectionId})
                return []
            }
            return frameSideModel.getFrameSides(frameSideIds, inspectionId, uid)
        },
        hiveStatistics: async (_, {hiveId}, {uid}) => {
            if (!uid) {
                logger.error('Attempt to access hiveStatistics without uid', {hiveId})
                return { workerBeeCount: 0, droneCount: 0, varroaCount: 0 }
            }
            return fileModel.getHiveStatistics(hiveId, uid)
        }
    },
    Hive: {
        files: async (hive, _, {uid}) => {
            return fileModel.getByHiveId(hive.id, uid);
        },
        beeCount: async (hive, _, {uid}) => {
            return fileModel.countAllBees(hive.id, uid);
        }
    },
    File: {
        __resolveReference: async ({id}, {uid}) => {
            return fileModel.getById(id, uid)
        },
        resizes: async ({id}, __, {uid}) => {
            return await fileResizeModel.getResizes(id, uid)
        }
    },
    FrameSide: {
        __resolveReference: async ({id}, {uid}) => {
            const isConfirmed = await frameSideModel.getQueenConfirmation(id, uid);
            return {
                __typename: 'FrameSide',
                id,
                frameSideId: id,
                isQueenConfirmed: isConfirmed ?? false
            };
        },
        
        isQueenConfirmed: async (parent, _, {uid}) => {
            const confirmationStatus = await frameSideModel.getQueenConfirmation(parent.id, uid);
            return confirmationStatus ?? false;
        },

        file: async ({id}, __, {uid}) => {
            return await fileModel.getByFrameSideId(id, uid)
        },
        cells: async (parent, __, context, info) => {
            const {uid, loaders} = context;
            let frameSideId = parent.frameSideId ? parent.frameSideId : parent.id;

            if (loaders && loaders.frameSideCellsLoader) {
                return await loaders.frameSideCellsLoader.load(String(frameSideId));
            }

            return await frameSideCellsModel.getByFrameSideId(frameSideId, uid, getRequestedParams(info));
        },

        frameSideFile: async ({id}, __, {uid}) => {
            const latestFileRel = await frameSideModel.getLastestByFrameSideId(id, uid);
            return ({
                __typename: 'FrameSideFile',
                frameSideId: id,
                fileId: latestFileRel?.file?.id
            })
        }
    },
    FrameSideInspection: {
        file: async ({frameSideId, inspectionId}, __, {uid}) => {
            return await fileModel.getByFrameSideAndInspectionId(frameSideId, inspectionId, uid)
        },
        cells: async ({frameSideId, inspectionId}, __, {uid}) => {
            return await frameSideCellsModel.getByFrameSideAndInspectionId(frameSideId, inspectionId, uid)
        },
        frameSideFile: async ({frameSideId}, __, {uid}) => {
            return ({frameSideId})
        }
    },
    FrameSideFile: {
        queenDetected: async (parent, _, {uid}) => {
            const presence = await frameSideModel.getQueenPresence(parent.frameSideId, uid);
            return presence === true;
        },
        isBeeDetectionComplete: async (parent, _, {uid}) => {
            const latestFileRel = await frameSideModel.getLastestByFrameSideId(parent.frameSideId, uid);
            const fileId = latestFileRel?.file?.id;
            if (!fileId) {
                 return false;
            }
            return jobs.isComplete(TYPE_BEES, fileId)
        },
        isCellsDetectionComplete: async (parent, _, {uid}) => {
            const latestFileRel = await frameSideModel.getLastestByFrameSideId(parent.frameSideId, uid);
            const fileId = latestFileRel?.file?.id;
            if (!fileId) {
                 return false;
            }
            return jobs.isComplete(TYPE_CELLS, fileId)
        },
        isQueenCupsDetectionComplete: async (parent, _, {uid}) => {
            const latestFileRel = await frameSideModel.getLastestByFrameSideId(parent.frameSideId, uid);
            const fileId = latestFileRel?.file?.id;
            if (!fileId) {
                 return false;
            }
            return jobs.isComplete(TYPE_CUPS, fileId)
        },
        isQueenDetectionComplete: async (parent, _, {uid}) => {
            const latestFileRel = await frameSideModel.getLastestByFrameSideId(parent.frameSideId, uid);
            const fileId = latestFileRel?.file?.id;
            if (!fileId) {
                 return false;
            }
            const isCompleteResult = await jobs.isComplete(TYPE_QUEENS, fileId);
            return isCompleteResult;
        },

        // todo add caching or dedicated column around this
        detectedBees: async (parent, _, {uid}) => {
            return frameSideModel.getDetectedBeesAndQueensFromLatestFile(parent.frameSideId, uid)
        },
        detectedVarroa: async (parent, _, {uid}) => {
            return frameSideModel.getDetectedVarroa(parent.frameSideId, uid)
        },
        detectedCells: async (parent, _, {uid}) => {
            return frameSideModel.getDetectedCells(parent.frameSideId, uid)
        },
        detectedQueenCount: async (parent, _, {uid}) => {
            return frameSideModel.getQueenCount(parent.frameSideId, uid)
        },
        varroaCount: async (parent, _, {uid}) => {
            return frameSideModel.getVarroaCount(parent.frameSideId, uid)
        },
        detectedWorkerBeeCount: async (parent, _, {uid}) => {
            return frameSideModel.getWorkerBeeCount(parent.frameSideId, uid)
        },
        detectedDroneCount: async (parent, _, {uid}) => {
            return frameSideModel.getDroneCount(parent.frameSideId, uid)
        },
        detectedDrones: async (parent, _, {uid}) => {
            return frameSideModel.getDetectedDrones(parent.frameSideId, uid)
        },
        isDroneDetectionComplete: async (parent, _, {uid}) => {
            const latestFileRel = await frameSideModel.getLastestByFrameSideId(parent.frameSideId, uid);
            const fileId = latestFileRel?.file?.id;
            if (!fileId) {
                 return false;
            }
            return jobs.isComplete(TYPE_DRONES, fileId)
        },
    },
    Mutation: {
        cloneFramesForInspection: async (_, {frameSideIDs, inspectionId}, {uid}) => {
            await frameSideModel.cloneFramesForInspection(frameSideIDs, inspectionId, uid);
            await frameSideCellsModel.cloneFramesForInspection(frameSideIDs, inspectionId, uid);
            await frameSideQueenCupsModel.cloneFramesForInspection(frameSideIDs, inspectionId, uid);

            const hiveId = await frameSideModel.getHiveIdFromFrameSides(frameSideIDs, uid);

            if (hiveId) {
                try {
                    const stats = await fileModel.getHiveStatistics(hiveId, uid);

                    await sendPopulationMetrics(
                        hiveId,
                        stats.workerBeeCount || 0,
                        stats.droneCount || 0,
                        stats.varroaCount || 0,
                        String(inspectionId)
                    );
                } catch (error) {
                    logger.error('Failed to send population metrics', { error, hiveId, inspectionId });
                }
            }

            return true
        },
        generateHiveAdvice: async (_, {hiveID, adviceContext, langCode = 'en'}, {uid}) => {
            langCode = langCode.substring(0, 2)
            const question = beekeeper.generatePrompt(langCode, adviceContext)
            const answer = await beekeeper.generateHiveAdvice(question)
            beekeeper.insert(uid, hiveID, question, answer)
            return answer
        },
        addFileToFrameSide: async (_, {frameSideId, fileId, hiveId}, {uid}) => {
            await fileModel.addFrameRelation(fileId, frameSideId, uid);
            await frameSideCellsModel.addFrameCells(fileId, frameSideId, uid);
            await frameSideQueenCupsModel.addFrameCups(fileId, frameSideId, uid);

            await fileModel.addHiveRelation(fileId, hiveId, uid);

            // Add frame-side processing jobs
            await Promise.all([
                jobs.addJob(TYPE_BEES, fileId),
                jobs.addJob(TYPE_DRONES, fileId),
                jobs.addJob(TYPE_CELLS, fileId),
                jobs.addJob(TYPE_CUPS, fileId),
                jobs.addJob(TYPE_QUEENS, fileId),
                jobs.addJob(TYPE_VARROA, fileId)
            ]);

            return true
        },

        addFileToBox: async (_, {boxId, fileId, hiveId, boxType}, {uid}) => {
            await boxFileModel.addBoxRelation(fileId, boxId, uid);
            await fileModel.addHiveRelation(fileId, hiveId, uid);

            if (boxType === 'BOTTOM') {
                await jobs.addJob(TYPE_VARROA_BOTTOM, fileId);
            }

            return true
        },

        uploadFrameSide,

        filesStrokeEditMutation: async (_, {files}, {uid}) => {
            return await frameSideModel.updateStrokes(files, uid);
        },

        confirmFrameSideQueen: async (_, {frameSideId, isConfirmed}, {uid}) => {
            // Call the model function which returns true on success
            const success = await frameSideModel.updateQueenConfirmation(frameSideId, isConfirmed, uid);
            // Return the boolean result, matching the updated schema
            return success;
        },

        updateFrameSideCells: async (_, {cells}, {uid}) => {
            await frameSideCellsModel.updateRelativeCells(cells, uid, cells.id);
            return true
        }
    },
    Upload: GraphQLUpload,
}

function getRequestedParams(info: any): string[] {
    const {fields} = simplifyParsedResolveInfoFragmentWithType(
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
