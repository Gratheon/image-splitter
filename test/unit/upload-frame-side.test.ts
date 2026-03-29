import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

jest.mock('../../src/logger', () => ({
	logger: {
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
	},
}));

jest.mock('../../src/models/image', () => ({
	getOriginalFileLocalPath: jest.fn(),
	convertWebpToJpg: jest.fn(),
	getImageDimensions: jest.fn(),
	preprocessLargeImage: jest.fn(),
}));

jest.mock('../../src/models/file', () => ({
	getFileExtension: jest.fn(),
	insert: jest.fn(),
}));

jest.mock('../../src/models/s3', () => jest.fn());

jest.mock('../../src/models/fileResize', () => ({
	getResizes: jest.fn(),
}));

jest.mock('../../src/models/jobs', () => ({
	__esModule: true,
	TYPE_RESIZE: 'TYPE_RESIZE',
	default: {
		addJob: jest.fn(),
	},
}));

import uploadFrameSide from '../../src/graphql/upload-frame-side';
import * as imageModel from '../../src/models/image';
import fileModel from '../../src/models/file';
import upload from '../../src/models/s3';
import fileResizeModel from '../../src/models/fileResize';
import jobs from '../../src/models/jobs';

describe('uploadFrameSide', () => {
	const tmpRoot = path.join(os.tmpdir(), `image-splitter-upload-test-${Date.now()}`);

	beforeEach(() => {
		jest.clearAllMocks();
		fs.mkdirSync(tmpRoot, { recursive: true });

		jest.spyOn(global, 'setTimeout').mockImplementation(((_fn: any) => 0) as any);

		(imageModel.getOriginalFileLocalPath as jest.Mock).mockImplementation(
			(uid: string, filename: string) => path.join(tmpRoot, `${uid}_${filename}`)
		);
		(imageModel.getImageDimensions as jest.Mock).mockResolvedValue({ width: 640, height: 480 });
		(imageModel.preprocessLargeImage as jest.Mock).mockResolvedValue(null);
		(fileModel.getFileExtension as jest.Mock).mockImplementation((filename: string) => {
			const ext = path.extname(filename);
			return ext ? ext.slice(1).toLowerCase() : '';
		});
		(fileModel.insert as jest.Mock).mockResolvedValue(101);
		(upload as jest.Mock).mockResolvedValue('https://example.test/file');
		(fileResizeModel.getResizes as jest.Mock).mockResolvedValue([]);
		(jobs.addJob as jest.Mock).mockResolvedValue(undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	function buildUpload(filename: string, mimetype: string, data: Buffer) {
		return Promise.resolve({
			filename,
			mimetype,
			createReadStream: () => Readable.from([data]),
		});
	}

	it('falls back to original webp when conversion fails', async () => {
		(imageModel.convertWebpToJpg as jest.Mock).mockRejectedValue(new Error('conversion failed'));

		await uploadFrameSide(
			null,
			{ file: buildUpload('queen-preview.webp', 'image/webp', Buffer.from('fake-webp')) },
			{ uid: '7' }
		);

		expect(upload).toHaveBeenCalledTimes(1);
		const [uploadedLocalPath, uploadedS3Key] = (upload as jest.Mock).mock.calls[0];
		expect(String(uploadedLocalPath)).toMatch(/\.webp$/);
		expect(String(uploadedS3Key)).toMatch(/\/original\.webp$/);
	});

	it('uses converted jpg when webp conversion succeeds', async () => {
		(imageModel.convertWebpToJpg as jest.Mock).mockImplementation(async (_webpPath: string, jpgPath: string) => {
			fs.writeFileSync(jpgPath, 'fake-jpeg-data');
			return 'ok';
		});

		await uploadFrameSide(
			null,
			{ file: buildUpload('queen-preview.webp', 'image/webp', Buffer.from('fake-webp')) },
			{ uid: '7' }
		);

		expect(upload).toHaveBeenCalledTimes(1);
		const [uploadedLocalPath, uploadedS3Key] = (upload as jest.Mock).mock.calls[0];
		expect(String(uploadedLocalPath)).toMatch(/\.jpg$/);
		expect(String(uploadedS3Key)).toMatch(/\/original\.jpg$/);
	});
});
