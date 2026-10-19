process.env.ENV_ID = process.env.ENV_ID || 'testing';
process.env.NATIVE = process.env.NATIVE || '1';

process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5101';
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'image_splitter';
process.env.DB_SSL = process.env.DB_SSL || 'disable';

process.env.AWS_TARGET_UPLOAD_ENDPOINT = process.env.AWS_TARGET_UPLOAD_ENDPOINT || 'http://localhost:19000/';
process.env.AWS_PUBLIC_URL = process.env.AWS_PUBLIC_URL || 'http://localhost:19000/gratheon-test/';
process.env.REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
process.env.REDIS_PORT = process.env.REDIS_PORT || '16379';
process.env.REDIS_USERNAME = process.env.REDIS_USERNAME || 'default';
process.env.REDIS_PASSWORD = process.env.REDIS_PASSWORD || 'pass';
