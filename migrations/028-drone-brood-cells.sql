-- MySQL-compatible idempotent migration (MySQL 8.2 does not support ADD COLUMN IF NOT EXISTS)
SET @col_exists := (
	SELECT COUNT(*)
	FROM INFORMATION_SCHEMA.COLUMNS
	WHERE TABLE_SCHEMA = DATABASE()
		AND TABLE_NAME = 'files_frame_side_cells'
		AND COLUMN_NAME = 'nectar'
);
SET @sql := IF(
	@col_exists = 0,
	'ALTER TABLE `files_frame_side_cells` ADD COLUMN `nectar` INT NULL DEFAULT NULL AFTER `eggs`',
	'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
	SELECT COUNT(*)
	FROM INFORMATION_SCHEMA.COLUMNS
	WHERE TABLE_SCHEMA = DATABASE()
		AND TABLE_NAME = 'files_frame_side_cells'
		AND COLUMN_NAME = 'drone_brood_cell_count'
);
SET @sql := IF(
	@col_exists = 0,
	'ALTER TABLE `files_frame_side_cells` ADD COLUMN `drone_brood_cell_count` INT NULL DEFAULT NULL AFTER `nectar_cell_count`',
	'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
	SELECT COUNT(*)
	FROM INFORMATION_SCHEMA.COLUMNS
	WHERE TABLE_SCHEMA = DATABASE()
		AND TABLE_NAME = 'files_frame_side_cells'
		AND COLUMN_NAME = 'drone_brood'
);
SET @sql := IF(
	@col_exists = 0,
	'ALTER TABLE `files_frame_side_cells` ADD COLUMN `drone_brood` INT NULL DEFAULT NULL AFTER `nectar`',
	'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
