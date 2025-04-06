-- Grant privileges to the 'test' user on the 'logs' database.
-- Note: The 'test' user and 'image-splitter' database are created by environment variables.
-- The 'logs' database needs to be added to MYSQL_DATABASE env var as well.
GRANT ALL PRIVILEGES ON `logs`.* TO 'test'@'%';
FLUSH PRIVILEGES;
