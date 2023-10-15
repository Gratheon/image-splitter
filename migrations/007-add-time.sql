ALTER TABLE `files_frame_side_rel` CHANGE `added_time` `added_time` DATETIME  NULL  DEFAULT CURRENT_TIMESTAMP;
UPDATE files_frame_side_rel SET added_time=NOW() WHERE added_time IS NULL;
ALTER TABLE `files_frame_side_rel` CHANGE `added_time` `added_time` DATETIME  NOT NULL  DEFAULT CURRENT_TIMESTAMP;
