import {parseResolveInfo, simplifyParsedResolveInfoFragmentWithType} from 'graphql-parse-resolve-info';
import {GraphQLUpload} from 'graphql-upload';

import {logger} from '../logger';

import fileModel from '../models/file';
import fileResizeModel from '../models/fileResize';
import frameSideModel from '../models/frameSide';
import frameSideCellsModel from '../models/frameSideCells';
import frameSideQueenCupsModel from '../models/frameSideQueenCups';
import beekeeper from '../models/ai-beekeeper';

import uploadFrameSide from "./upload-frame-side";
import jobs, {TYPE_BEES, TYPE_CELLS, TYPE_CUPS} from "../models/jobs";


export const resolvers = {
    Query: {
        file: async (_, {id}, {uid}) => {
            return await fileModel.getById(id, uid)
        },
        hiveFiles: async (_, {hiveId}, {uid}) => {
            return fileModel.getByHiveId(hiveId, uid)
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
            return {
                __typename: 'FrameSide',
                id,
                frameSideId: id
            };
        },

        file: async ({id}, __, {uid}) => {
            return await fileModel.getByFrameSideId(id, uid)
        },
        cells: async (parent, __, {uid}, info) => {
            let frameSideId = parent.frameSideId ? parent.frameSideId : parent.id
            return await frameSideCellsModel.getByFrameSideId(frameSideId, uid, getRequestedParams(info))
        },

        frameSideFile: async ({frameSideId}, __, {uid}) => {
            return ({
                __typename: 'FrameSideFile',
                frameSideId
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
            return frameSideModel.isQueenDetected(parent.frameSideId, uid)
        },
        isBeeDetectionComplete: async (parent, _, {uid}) => {
            let frameSide = await frameSideModel.getLastestByFrameSideId(parent.frameSideId, uid)
            if(!frameSide) {
                return false
            }
            return jobs.isComplete(TYPE_BEES, frameSide?.id)
        },
        isCellsDetectionComplete: async (parent, _, {uid}) => {
            let frameSide = await frameSideModel.getLastestByFrameSideId(parent.frameSideId, uid)
            if(!frameSide) {
                return false
            }

            return jobs.isComplete(TYPE_CELLS, frameSide?.id)
        },
        isQueenCupsDetectionComplete: async (parent, _, {uid}) => {
            let frameSide = await frameSideModel.getLastestByFrameSideId(parent.frameSideId, uid)
            if(!frameSide) {
                return false
            }

            return jobs.isComplete(TYPE_CUPS, frameSide?.id)
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
    },
    Mutation: {
        cloneFramesForInspection: async (_, {frameSideIDs, inspectionId}, {uid}) => {
            await frameSideModel.cloneFramesForInspection(frameSideIDs, inspectionId, uid);
            await frameSideCellsModel.cloneFramesForInspection(frameSideIDs, inspectionId, uid);
            await frameSideQueenCupsModel.cloneFramesForInspection(frameSideIDs, inspectionId, uid);

            return true
        },
        generateHiveAdvice: async (_, {hiveID, adviceContext, langCode = 'en'}, {uid}) => {
            langCode = langCode.substring(0, 2) // avoid injections
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
            return true
        },

        // main file upload function, see upload-frame-side.ts
        uploadFrameSide,

        filesStrokeEditMutation: async (_, {files}, {uid}) => {
            return await frameSideModel.updateStrokes(files, uid);
        },

        updateFrameSideQueenPresense: async (_, {frameSideId, isPresent}, {uid}) => {
            return await frameSideModel.updateFrameSideQueenPresense(frameSideId, isPresent, uid);
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

