-- Create the separate 'logs' database explicitly
CREATE DATABASE IF NOT EXISTS `logs`;

-- Create the logs table within the 'logs' database
CREATE TABLE IF NOT EXISTS `logs`.`logs` (
    `id`        int auto_increment primary key,
    `level`     varchar(16)   not null,
    `message`   varchar(2048) not null,
    `meta`      varchar(2048) not null,
    `timestamp` datetime      not null
);

-- Grant privileges to the 'test' user on BOTH databases.
-- The 'test' user and 'image-splitter' database are created by environment variables.
GRANT ALL PRIVILEGES ON `image-splitter`.* TO 'test'@'%';
GRANT ALL PRIVILEGES ON `logs`.* TO 'test'@'%';
FLUSH PRIVILEGES;
