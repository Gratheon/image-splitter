process.env.ENV_ID = process.env.ENV_ID || 'testing';
process.env.NATIVE = process.env.NATIVE || '1';

process.env.MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
process.env.MYSQL_PORT = process.env.MYSQL_PORT || '5101';
process.env.MYSQL_USER = process.env.MYSQL_USER || 'test';
process.env.MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'test';
process.env.MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'image-splitter';

process.env.AWS_TARGET_UPLOAD_ENDPOINT = process.env.AWS_TARGET_UPLOAD_ENDPOINT || 'http://localhost:19000/';
process.env.AWS_PUBLIC_URL = process.env.AWS_PUBLIC_URL || 'http://localhost:19000/gratheon-test/';
