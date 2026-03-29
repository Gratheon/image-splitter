import path from 'path';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

jest.mock('graphql-upload/GraphQLUpload.mjs', () => ({
  __esModule: true,
  default: {},
}));

import { resolvers } from '../../src/graphql/resolvers';
import fileModel from '../../src/models/file';
import { ensureBucketExists } from '../../src/models/s3';
import uploadToS3 from '../../src/models/s3';
import { initStorage, isStorageConnected, sql, storage } from '../../src/models/storage';
import { logger } from '../../src/logger';
import config from '../../src/config';
import { TYPE_BEES, TYPE_CELLS, TYPE_CUPS, TYPE_DRONES, TYPE_QUEENS, TYPE_VARROA } from '../../src/models/jobs';
import jobs from '../../src/models/jobs';

const runSeed = Math.floor(Math.random() * 10_000_000);
let seq = 0;

function nextId(): number {
  seq += 1;
  return 1_000_000_000 + runSeed * 100 + seq;
}

async function waitForStorageReady(timeoutMs = 20000) {
  const start = Date.now();
  while (!isStorageConnected()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for storage connection (mysql host=${config.mysql.host} port=${config.mysql.port} db=${config.mysql.database})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('graphql resolvers integration', () => {
  beforeAll(async () => {
    await initStorage(logger);
    await waitForStorageReady();
    await ensureBucketExists();
  });

  afterAll(async () => {
    const db: any = storage();
    if (db?.dispose) {
      await db.dispose();
    }
  });

  it('resolves file query for object stored in real minio', async () => {
    // arrange
    const uid = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fixturePath = path.resolve(__dirname, './fixture/IMG_4368.JPG');
    const key = `${uid}/${hash}/original.jpg`;
    const uploadedUrl = await uploadToS3(fixturePath, key);
    const fileId = await fileModel.insert(uid, `minio-${hash}.jpg`, 'jpg', hash, 1200, 900);

    // act
    const file = await resolvers.Query.file({}, { id: fileId }, { uid: String(uid) });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let uploadedFileResponse: Response;
    try {
      uploadedFileResponse = await fetch(uploadedUrl, { method: 'HEAD', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    // assert
    expect(file.id).toBe(fileId);
    expect(file.url).toBe(uploadedUrl);
    expect(uploadedFileResponse.status).toBe(200);

    const dbRows = await storage().query(sql`
      SELECT id, user_id FROM files WHERE id = ${fileId} LIMIT 1
    `);
    expect(dbRows[0]?.id).toBe(fileId);
    expect(Number(dbRows[0]?.user_id)).toBe(uid);
  });

  it('adds file to frame side with uid fallback and creates detection jobs', async () => {
    // arrange
    const uid = nextId();
    const frameSideId = nextId();
    const hiveId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `file-${frameSideId}.jpg`, 'jpg', hash, 1920, 1080);
    const encodedFileId = Buffer.from(`File:${fileId}`).toString('base64');
    const encodedFrameSideId = Buffer.from(`FrameSide:${frameSideId}`).toString('base64');
    const encodedHiveId = Buffer.from(`Hive:${hiveId}`).toString('base64');
    const addJobSpy = jest.spyOn(jobs, 'addJob').mockResolvedValue(undefined);

    // act
    const result = await resolvers.Mutation.addFileToFrameSide(
      {},
      { frameSideId: encodedFrameSideId, fileId: encodedFileId, hiveId: encodedHiveId },
      { uid: undefined }
    );

    // assert
    expect(result).toBe(true);

    const frameRel = await storage().query(sql`
      SELECT file_id, frame_side_id, user_id
      FROM files_frame_side_rel
      WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
      LIMIT 1
    `);
    expect(frameRel.length).toBe(1);

    const hiveRel = await storage().query(sql`
      SELECT file_id, hive_id, user_id
      FROM files_hive_rel
      WHERE file_id = ${fileId} AND hive_id = ${hiveId} AND user_id = ${uid}
      LIMIT 1
    `);
    expect(hiveRel.length).toBe(1);

    const frameCells = await storage().query(sql`
      SELECT file_id FROM files_frame_side_cells
      WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
      LIMIT 1
    `);
    expect(frameCells.length).toBe(1);

    const frameCups = await storage().query(sql`
      SELECT file_id FROM files_frame_side_queen_cups
      WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
      LIMIT 1
    `);
    expect(frameCups.length).toBe(1);

    const createdJobNames = new Set(addJobSpy.mock.calls.map((call) => call[0]));
    expect(createdJobNames).toEqual(new Set([TYPE_BEES, TYPE_DRONES, TYPE_CELLS, TYPE_CUPS, TYPE_QUEENS, TYPE_VARROA]));
    addJobSpy.mockRestore();
  });

  it('returns hive statistics aggregated from frame and bottom detections', async () => {
    // arrange
    const uid = nextId();
    const frameSideId = nextId();
    const hiveId = nextId();
    const boxId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `stats-${frameSideId}.jpg`, 'jpg', hash, 1200, 900);

    await fileModel.addFrameRelation(fileId, frameSideId, uid);
    await fileModel.addHiveRelation(fileId, hiveId, uid);

    await storage().query(sql`
      UPDATE files_frame_side_rel
      SET worker_bee_count = 8, drone_count = 2, queen_count = 1, varroa_count = 3
      WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
    `);

    await storage().query(sql`
      INSERT INTO files_box_rel (box_id, file_id, user_id) VALUES (${boxId}, ${fileId}, ${uid})
    `);
    await storage().query(sql`
      INSERT INTO varroa_bottom_detections (file_id, box_id, user_id, varroa_count, detections)
      VALUES (${fileId}, ${boxId}, ${uid}, 4, JSON_ARRAY())
      ON DUPLICATE KEY UPDATE varroa_count = VALUES(varroa_count)
    `);

    // act
    const statistics = await resolvers.Query.hiveStatistics({}, { hiveId }, { uid: String(uid) });

    // assert
    expect(statistics).toEqual({
      workerBeeCount: 11,
      droneCount: 2,
      varroaCount: 7,
    });
  });

  it('resolves queen confirmation and job completion fields for frame side file', async () => {
    // arrange
    const uid = nextId();
    const frameSideId = nextId();
    const hash = `hash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const fileId = await fileModel.insert(uid, `resolver-${frameSideId}.jpg`, 'jpg', hash, 800, 600);
    await fileModel.addFrameRelation(fileId, frameSideId, uid);

    await storage().query(sql`
      UPDATE files_frame_side_rel
      SET queen_detected = TRUE, is_queen_confirmed = TRUE
      WHERE file_id = ${fileId} AND frame_side_id = ${frameSideId} AND user_id = ${uid} AND inspection_id IS NULL
    `);

    await storage().query(sql`
      INSERT INTO jobs (name, ref_id, process_end_time, payload, priority)
      VALUES (${TYPE_BEES}, ${fileId}, NOW(), JSON_OBJECT(), 3)
    `);
    await storage().query(sql`
      INSERT INTO jobs (name, ref_id, process_end_time, payload, priority)
      VALUES (${TYPE_CELLS}, ${fileId}, NULL, JSON_OBJECT(), 3)
    `);

    // act
    const frameSideReference = await resolvers.FrameSide.__resolveReference({ id: frameSideId }, { uid: String(uid) });
    const isQueenConfirmed = await resolvers.FrameSide.isQueenConfirmed({ id: frameSideId }, {}, { uid: String(uid) });
    const queenDetected = await resolvers.FrameSideFile.queenDetected({ frameSideId, fileId }, {}, { uid: String(uid) });
    const isBeeDetectionComplete = await resolvers.FrameSideFile.isBeeDetectionComplete(
      { frameSideId, fileId },
      {},
      { uid: String(uid) }
    );
    const isCellsDetectionComplete = await resolvers.FrameSideFile.isCellsDetectionComplete(
      { frameSideId, fileId },
      {},
      { uid: String(uid) }
    );

    // assert
    expect(frameSideReference.isQueenConfirmed).toBe(true);
    expect(isQueenConfirmed).toBe(true);
    expect(queenDetected).toBe(true);
    expect(isBeeDetectionComplete).toBe(true);
    expect(isCellsDetectionComplete).toBe(false);
  });

  it('round-trips detection settings via mutation and query resolvers', async () => {
    // arrange
    const uid = nextId();
    const confidencePercents = {
      bees: 70,
      drones: 50,
      queens: 80,
      queenCups: 60,
      varroa: 90,
      varroaBottom: 40,
    };

    // act
    const updated = await resolvers.Mutation.setDetectionConfidencePercents(
      {},
      { confidencePercents },
      { uid: String(uid) }
    );
    const fetched = await resolvers.Query.detectionSettings({}, {}, { uid: String(uid) });

    // assert
    expect(updated.confidencePercents).toEqual(confidencePercents);
    expect(updated.thresholds).toEqual({
      bees: 0.7,
      drones: 0.5,
      queens: 0.8,
      queenCups: 0.6,
      varroa: 0.9,
      varroaBottom: 0.4,
    });
    expect(fetched.confidencePercents).toEqual(confidencePercents);
  });
});
