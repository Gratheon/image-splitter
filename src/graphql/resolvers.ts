import {parseResolveInfo, simplifyParsedResolveInfoFragmentWithType} from 'graphql-parse-resolve-info';
import GraphQLUpload from 'graphql-upload/GraphQLUpload.mjs';
import { GraphQLResolveInfo } from 'graphql';

import {logger} from '../logger';

import fileModel from '../models/file';
import fileResizeModel from '../models/fileResize';
import frameSideModel from '../models/frameSide';
import frameSideCellsModel from '../models/frameSideCells';
import frameSideQueenCupsModel from '../models/frameSideQueenCups';
import boxFileModel from '../models/boxFile';
import beekeeper from '../models/ai-beekeeper';
import detectionSettingsModel from '../models/detectionSettings';
import { sendPopulationMetrics } from '../models/telemetryClient';

import uploadFrameSide, { uploadApiaryPhoto } from "./upload-frame-side";
import jobs, {TYPE_BEES, TYPE_DRONES, TYPE_CELLS, TYPE_CUPS, TYPE_QUEENS, TYPE_VARROA, TYPE_VARROA_BOTTOM} from "../models/jobs";

type NumericId = number;

interface ResolverContext {
    uid?: NumericId;
    billingPlan?: string;
    loaders?: {
        frameSideCellsLoader?: {
            load: (key: string) => Promise<unknown>;
        };
    } | null;
}

interface IdArgs {
    id: NumericId;
}

interface HiveIdArgs {
    hiveId: NumericId;
}

interface BoxFilesArgs {
    boxId: NumericId;
    inspectionId?: NumericId;
}

interface ExistingHiveAdviceArgs {
    hiveID: NumericId;
}

interface FrameSideIdArgs {
    frameSideId: NumericId;
}

interface FrameSidesInspectionsArgs {
    frameSideIds: NumericId[];
    inspectionId: NumericId;
}

interface CloneFramesForInspectionArgs {
    frameSideIDs: NumericId[];
    inspectionId: NumericId;
}

interface GenerateHiveAdviceArgs {
    hiveID: NumericId;
    adviceContext: string;
    langCode?: string;
}

interface SetDetectionConfidencePercentsArgs {
    confidencePercents: unknown;
}

interface AddFileToFrameSideArgs {
    frameSideId: NumericId;
    fileId: NumericId;
    hiveId: NumericId;
}

interface AddFileToBoxArgs {
    boxId: NumericId;
    fileId: NumericId;
    hiveId: NumericId;
    boxType: 'BOTTOM' | string;
}

interface FilesStrokeEditMutationArgs {
    files: unknown[];
}

interface ConfirmFrameSideQueenArgs {
    frameSideId: NumericId;
    isConfirmed: boolean;
}

interface UpdateFrameSideCellsArgs {
    cells: { id: NumericId } & Record<string, unknown>;
}

interface HiveParent {
    id: NumericId;
}

interface FrameSideParent {
    id: NumericId;
    frameSideId?: NumericId;
}

interface FrameSideInspectionParent {
    frameSideId: NumericId;
    inspectionId: NumericId;
}

interface FrameSideFileParent {
    frameSideId?: NumericId;
    fileId?: NumericId;
    file?: {
        id?: number | string;
    };
}


export const resolvers = {
    Query: {
        hello_image_splitter: () => 'hi',
        file: async (_: unknown, {id}: IdArgs, {uid}: ResolverContext) => {
            return await fileModel.getById(id, uid)
        },
        detectionSettings: async (_: unknown, __: unknown, {uid}: ResolverContext) => {
            if (!uid) {
                throw new Error('Authentication required');
            }
            return await detectionSettingsModel.getByUserId(+uid);
        },
        hiveFiles: async (_: unknown, {hiveId}: HiveIdArgs, {uid}: ResolverContext) => {
            return fileModel.getByHiveId(hiveId, uid)
        },
        varroaBottomDetections: async (_: unknown, {boxId, inspectionId}: BoxFilesArgs, {uid}: ResolverContext) => {
            return await boxFileModel.getVarroaDetections(boxId, uid, inspectionId);
        },
        boxFiles: async (_: unknown, {boxId, inspectionId}: BoxFilesArgs, {uid}: ResolverContext) => {
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
        getExistingHiveAdvice: (_: unknown, {hiveID}: ExistingHiveAdviceArgs, {uid}: ResolverContext) => {
            return beekeeper.getAdvice(hiveID, uid)
        },
        aiAdvisorUsage: async (_: unknown, __: unknown, {uid, billingPlan}: ResolverContext) => {
            return await beekeeper.getMonthlyUsage(+uid, billingPlan);
        },
        hiveFrameSideFile: async (_: unknown, {frameSideId}: FrameSideIdArgs, {uid}: ResolverContext) => {
            return frameSideModel.getLastestByFrameSideId(frameSideId, uid)
        },
        hiveFrameSideCells: async (_: unknown, {frameSideId}: FrameSideIdArgs, {uid}: ResolverContext, info: GraphQLResolveInfo) => {
            return frameSideCellsModel.getByFrameSideId(frameSideId, uid, getRequestedParams(info))
        },
        // Loads all frame sides for a particular past inspection
        frameSidesInspections: async (_: unknown, {frameSideIds, inspectionId}: FrameSidesInspectionsArgs, {uid}: ResolverContext) => {
            if (!uid) {
                logger.error('Attempt to access frameSidesInspections without uid', {frameSideIds, inspectionId})
                return []
            }
            return frameSideModel.getFrameSides(frameSideIds, inspectionId, uid)
        },
        hiveStatistics: async (_: unknown, {hiveId}: HiveIdArgs, {uid}: ResolverContext) => {
            if (!uid) {
                logger.warn('Attempt to access hiveStatistics without uid', {hiveId})
                return { workerBeeCount: 0, droneCount: 0, varroaCount: 0 }
            }
            return fileModel.getHiveStatistics(hiveId, uid)
        }
    },
    Hive: {
        files: async (hive: HiveParent, _: unknown, {uid}: ResolverContext) => {
            return fileModel.getByHiveId(hive.id, uid);
        },
        beeCount: async (hive: HiveParent, _: unknown, {uid}: ResolverContext) => {
            return fileModel.countAllBees(hive.id, uid);
        }
    },
    File: {
        __resolveReference: async ({id}: { id: NumericId }, {uid}: ResolverContext) => {
            return fileModel.getById(id, uid)
        },
        resizes: async ({id}: { id: NumericId }, __: unknown, {uid}: ResolverContext) => {
            return await fileResizeModel.getResizes(id, uid)
        }
    },
    FrameSide: {
        __resolveReference: async ({id}: { id: NumericId }, {uid}: ResolverContext) => {
            const isConfirmed = await frameSideModel.getQueenConfirmation(id, uid);
            return {
                __typename: 'FrameSide',
                id,
                frameSideId: id,
                isQueenConfirmed: isConfirmed ?? false
            };
        },
        
        isQueenConfirmed: async (parent: FrameSideParent, _: unknown, {uid}: ResolverContext) => {
            const confirmationStatus = await frameSideModel.getQueenConfirmation(parent.id, uid);
            return confirmationStatus ?? false;
        },

        file: async ({id}: { id: NumericId }, __: unknown, {uid}: ResolverContext) => {
            return await fileModel.getByFrameSideId(id, uid)
        },
        cells: async (parent: FrameSideParent, __: unknown, context: ResolverContext, info: GraphQLResolveInfo) => {
            const {uid, loaders} = context;
            let frameSideId = parent.frameSideId ? parent.frameSideId : parent.id;

            if (loaders && loaders.frameSideCellsLoader) {
                return await loaders.frameSideCellsLoader.load(String(frameSideId));
            }

            return await frameSideCellsModel.getByFrameSideId(frameSideId, uid, getRequestedParams(info));
        },

        frameSideFile: async ({id}: { id: NumericId }, __: unknown, {uid}: ResolverContext) => {
            const latestFileRel = await frameSideModel.getLastestByFrameSideId(id, uid);
            return ({
                __typename: 'FrameSideFile',
                frameSideId: id,
                fileId: latestFileRel?.file?.id
            })
        }
    },
    FrameSideInspection: {
        file: async ({frameSideId, inspectionId}: FrameSideInspectionParent, __: unknown, {uid}: ResolverContext) => {
            return await fileModel.getByFrameSideAndInspectionId(frameSideId, inspectionId, uid)
        },
        cells: async ({frameSideId, inspectionId}: FrameSideInspectionParent, __: unknown, {uid}: ResolverContext) => {
            return await frameSideCellsModel.getByFrameSideAndInspectionId(frameSideId, inspectionId, uid)
        },
        frameSideFile: async ({frameSideId}: FrameSideInspectionParent, __: unknown, {uid}: ResolverContext) => {
            return ({frameSideId})
        }
    },
    FrameSideFile: {
        _resolveFileIdForCompletion: async (parent: FrameSideFileParent, uid?: NumericId) => {
            const directFileId = Number(parent?.fileId ?? parent?.file?.id);
            if (Number.isFinite(directFileId) && directFileId > 0) {
                return directFileId;
            }
            if (!uid || !parent?.frameSideId) {
                return null;
            }
            const latestFileRel = await frameSideModel.getLastestByFrameSideId(parent.frameSideId, uid);
            const fallbackFileId = Number(latestFileRel?.file?.id);
            if (Number.isFinite(fallbackFileId) && fallbackFileId > 0) {
                return fallbackFileId;
            }
            return null;
        },
        queenDetected: async (parent: FrameSideFileParent, _: unknown, {uid}: ResolverContext) => {
            const presence = await frameSideModel.getQueenPresence(parent.frameSideId, uid);
            return presence === true;
        },
        isBeeDetectionComplete: async (parent: FrameSideFileParent, _: unknown, {uid}: ResolverContext) => {
            const fileId = await resolvers.FrameSideFile._resolveFileIdForCompletion(parent, uid);
            if (!fileId) {
                 return false;
            }
            return jobs.isComplete(TYPE_BEES, fileId)
        },
        isCellsDetectionComplete: async (parent: FrameSideFileParent, _: unknown, {uid}: ResolverContext) => {
            const fileId = await resolvers.FrameSideFile._resolveFileIdForCompletion(parent, uid);
            if (!fileId) {
                 return false;
            }
            return jobs.isComplete(TYPE_CELLS, fileId)
        },
        isQueenCupsDetectionComplete: async (parent: FrameSideFileParent, _: unknown, {uid}: ResolverContext) => {
            const fileId = await resolvers.FrameSideFile._resolveFileIdForCompletion(parent, uid);
            if (!fileId) {
                 return false;
            }
            return jobs.isComplete(TYPE_CUPS, fileId)
        },
        isQueenDetectionComplete: async (parent: FrameSideFileParent, _: unknown, {uid}: ResolverContext) => {
            const fileId = await resolvers.FrameSideFile._resolveFileIdForCompletion(parent, uid);
            if (!fileId) {
                 return false;
            }
            const isCompleteResult = await jobs.isComplete(TYPE_QUEENS, fileId);
            return isCompleteResult;
        },

        // todo add caching or dedicated column around this
        detectedBees: async (parent: FrameSideFileParent, _: unknown, {uid}: ResolverContext) => {
            return frameSideModel.getDetectedBeesAndQueensFromLatestFile(parent.frameSideId, uid)
        },
        detectedVarroa: async (parent: FrameSideFileParent, _: unknown, {uid}: ResolverContext) => {
            return frameSideModel.getDetectedVarroa(parent.frameSideId, uid)
        },
        detectedCells: async (parent: FrameSideFileParent, _: unknown, {uid}: ResolverContext) => {
            return frameSideModel.getDetectedCells(parent.frameSideId, uid)
        },
        detectedQueenCount: async (parent: FrameSideFileParent, _: unknown, {uid}: ResolverContext) => {
            return frameSideModel.getQueenCount(parent.frameSideId, uid)
        },
        varroaCount: async (parent: FrameSideFileParent, _: unknown, {uid}: ResolverContext) => {
            return frameSideModel.getVarroaCount(parent.frameSideId, uid)
        },
        detectedWorkerBeeCount: async (parent: FrameSideFileParent, _: unknown, {uid}: ResolverContext) => {
            return frameSideModel.getWorkerBeeCount(parent.frameSideId, uid)
        },
        detectedDroneCount: async (parent: FrameSideFileParent, _: unknown, {uid}: ResolverContext) => {
            return frameSideModel.getDroneCount(parent.frameSideId, uid)
        },
        detectedDrones: async (parent: FrameSideFileParent, _: unknown, {uid}: ResolverContext) => {
            return frameSideModel.getDetectedDrones(parent.frameSideId, uid)
        },
        isDroneDetectionComplete: async (parent: FrameSideFileParent, _: unknown, {uid}: ResolverContext) => {
            const fileId = await resolvers.FrameSideFile._resolveFileIdForCompletion(parent, uid);
            if (!fileId) {
                 return false;
            }
            return jobs.isComplete(TYPE_DRONES, fileId)
        },
    },
    Mutation: {
        cloneFramesForInspection: async (_: unknown, {frameSideIDs, inspectionId}: CloneFramesForInspectionArgs, {uid}: ResolverContext) => {
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
        generateHiveAdvice: async (_: unknown, {hiveID, adviceContext, langCode = 'en'}: GenerateHiveAdviceArgs, {uid, billingPlan}: ResolverContext) => {
            const currentPlan = String(billingPlan || '').toLowerCase();
            const allowedPlans = new Set(['starter', 'professional', 'enterprise']);

            if (!allowedPlans.has(currentPlan)) {
                logger.warn('generateHiveAdvice denied by billing plan', { uid, hiveID, billingPlan: currentPlan });
                return `<p>AI Advisor is available on Starter plan and above.</p><p>Please upgrade in Billing to generate hive advice.</p>`;
            }

            const usage = await beekeeper.getMonthlyUsage(+uid, currentPlan);
            if (beekeeper.isMonthlyUsageExceeded(usage)) {
                logger.warn('generateHiveAdvice denied by monthly usage cap', {
                    uid,
                    hiveID,
                    billingPlan: currentPlan,
                    usage,
                });
                return beekeeper.getUsageLimitReachedMessage();
            }

            langCode = langCode.substring(0, 2)
            const question = beekeeper.generatePrompt(langCode, adviceContext)
            const answer = await beekeeper.generateHiveAdvice(question, adviceContext, +uid)
            await beekeeper.insert(uid, hiveID, question, answer)
            return answer
        },
        setDetectionConfidencePercents: async (_: unknown, {confidencePercents}: SetDetectionConfidencePercentsArgs, {uid}: ResolverContext) => {
            if (!uid) {
                throw new Error('Authentication required');
            }
            return await detectionSettingsModel.setConfidencePercents(+uid, confidencePercents);
        },
        addFileToFrameSide: async (_: unknown, {frameSideId, fileId, hiveId}: AddFileToFrameSideArgs, {uid}: ResolverContext) => {
            let effectiveUid = uid;

            if (!effectiveUid) {
                const ownerId = await fileModel.getOwnerIdByFileId(fileId);
                effectiveUid = Number(ownerId);
                logger.warn("addFileToFrameSide called without uid in context; falling back to file owner", {
                    fileId,
                    frameSideId,
                    effectiveUid
                });
            }

            if (!effectiveUid || !Number.isFinite(effectiveUid)) {
                throw new Error(`Unable to resolve user for file ${fileId}`);
            }

            await fileModel.addFrameRelation(fileId, frameSideId, effectiveUid);
            await frameSideCellsModel.addFrameCells(fileId, frameSideId, effectiveUid);
            await frameSideQueenCupsModel.addFrameCups(fileId, frameSideId, effectiveUid);

            await fileModel.addHiveRelation(fileId, hiveId, effectiveUid);
            const detectionPayload = await detectionSettingsModel.getJobPayloadForUser(+effectiveUid);

            // Add frame-side processing jobs with priorities
            // Medium priority (3) for local AI processing
            // Low priority (5) for expensive external API calls
            await Promise.all([
                jobs.addJob(TYPE_BEES, fileId, detectionPayload, 3),
                jobs.addJob(TYPE_DRONES, fileId, detectionPayload, 3),
                jobs.addJob(TYPE_CELLS, fileId, detectionPayload, 3),
                jobs.addJob(TYPE_CUPS, fileId, detectionPayload, 5),
                jobs.addJob(TYPE_QUEENS, fileId, detectionPayload, 5),
                jobs.addJob(TYPE_VARROA, fileId, detectionPayload, 5)
            ]);

            return true
        },

        addFileToBox: async (_: unknown, {boxId, fileId, hiveId, boxType}: AddFileToBoxArgs, {uid}: ResolverContext) => {
            await boxFileModel.addBoxRelation(fileId, boxId, uid);
            await fileModel.addHiveRelation(fileId, hiveId, uid);
            const detectionPayload = await detectionSettingsModel.getJobPayloadForUser(+uid);

            if (boxType === 'BOTTOM') {
                await jobs.addJob(TYPE_VARROA_BOTTOM, fileId, detectionPayload, 5); // Low priority for external API
            }

            return true
        },

        uploadFrameSide,
        uploadApiaryPhoto,

        filesStrokeEditMutation: async (_: unknown, {files}: FilesStrokeEditMutationArgs, {uid}: ResolverContext) => {
            return await frameSideModel.updateStrokes(files, uid);
        },

        confirmFrameSideQueen: async (_: unknown, {frameSideId, isConfirmed}: ConfirmFrameSideQueenArgs, {uid}: ResolverContext) => {
            // Call the model function which returns true on success
            const success = await frameSideModel.updateQueenConfirmation(frameSideId, isConfirmed, uid);
            // Return the boolean result, matching the updated schema
            return success;
        },

        updateFrameSideCells: async (_: unknown, {cells}: UpdateFrameSideCellsArgs, {uid}: ResolverContext) => {
            await frameSideCellsModel.updateRelativeCells(cells, uid, cells.id);
            return true
        }
    },
    Upload: GraphQLUpload,
}

function getRequestedParams(info: GraphQLResolveInfo): string[] {
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
