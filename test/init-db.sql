-- Grant privileges to the 'test' user on BOTH databases.
-- The user and databases are created by environment variables in docker-compose.test.yml
GRANT ALL PRIVILEGES ON `image-splitter`.* TO 'test'@'%';
GRANT ALL PRIVILEGES ON `logs`.* TO 'test'@'%';
FLUSH PRIVILEGES;
