-- add primary id for referencing
ALTER TABLE `files_frame_side_cells` ADD `id` INT  UNSIGNED  NOT NULL  AUTO_INCREMENT  PRIMARY KEY  AFTER `frame_side_id`;
ALTER TABLE `files_frame_side_cells` MODIFY COLUMN `id` INT  UNSIGNED  NOT NULL  AUTO_INCREMENT FIRST;

-- create new table for async processing
CREATE TABLE `jobs`
(
    `id`                 int NOT NULL AUTO_INCREMENT,
    `type`               enum ('cells', 'bees','cups')
                             CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
    `process_start_time` datetime                                             DEFAULT NULL,
    `last_retry_time`    datetime                                             DEFAULT NULL,
    `retries`            int                                                  DEFAULT NULL,
    `process_end_time`   datetime                                             DEFAULT NULL,
    `ref_id`             int                                                  DEFAULT NULL,
    PRIMARY KEY (`id`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci;



-- migrate data
INSERT INTO `jobs` (`type`, `process_start_time`, `last_retry_time`, `retries`, `process_end_time`, `ref_id`)
SELECT 'cells', process_start_time, NULL, 0, process_end_time, id
FROM `files_frame_side_cells`;

-- Drop columns
ALTER TABLE `files_frame_side_cells` DROP `process_start_time`;
ALTER TABLE `files_frame_side_cells` DROP `process_end_time`;



-- add primary id for referencing
ALTER TABLE `files_frame_side_queen_cups` ADD `id` INT  UNSIGNED  NOT NULL  AUTO_INCREMENT  PRIMARY KEY  AFTER `process_end_time`;
ALTER TABLE `files_frame_side_queen_cups` MODIFY COLUMN `id` INT  UNSIGNED  NOT NULL  AUTO_INCREMENT FIRST;

INSERT INTO `jobs` (`type`, `process_start_time`, `last_retry_time`, `retries`, `process_end_time`, `ref_id`)
SELECT 'cups', process_start_time, NULL, 0, process_end_time, id
FROM `files_frame_side_queen_cups`;

-- Drop columns
ALTER TABLE `files_frame_side_queen_cups` DROP `process_start_time`;
ALTER TABLE `files_frame_side_queen_cups` DROP `process_end_time`;


-- bees
ALTER TABLE `files_frame_side_rel` ADD `id` INT  UNSIGNED  NOT NULL  AUTO_INCREMENT  PRIMARY KEY  AFTER `process_end_time`;
ALTER TABLE `files_frame_side_rel` MODIFY COLUMN `id` INT  UNSIGNED  NOT NULL  AUTO_INCREMENT FIRST;

INSERT INTO `jobs` (`type`, `process_start_time`, `last_retry_time`, `retries`, `process_end_time`, `ref_id`)
SELECT 'bees', process_start_time, NULL, 0, process_end_time, id
FROM `files_frame_side_rel`;

ALTER TABLE `files_frame_side_rel` DROP `process_start_time`;
ALTER TABLE `files_frame_side_rel` DROP `process_end_time`;