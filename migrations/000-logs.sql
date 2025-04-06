-- This migration is now effectively empty as the 'logs' database and 'logs.logs' table
-- are created by the init-db.sql script in the test environment.
-- Keeping the file ensures the migration runner doesn't complain about missing files
-- if the hash was previously recorded.

-- CREATE DATABASE IF NOT EXISTS logs;
-- create table IF NOT EXISTS logs.logs ... ;
