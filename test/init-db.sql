-- Create the separate 'logs' database explicitly
CREATE DATABASE IF NOT EXISTS `logs`;

-- Grant privileges to the 'test' user on BOTH databases.
-- The 'test' user and 'image-splitter' database are created by environment variables.
GRANT ALL PRIVILEGES ON `image-splitter`.* TO 'test'@'%';
GRANT ALL PRIVILEGES ON `logs`.* TO 'test'@'%';
FLUSH PRIVILEGES;
