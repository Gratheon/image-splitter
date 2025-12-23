SET SESSION sql_require_primary_key = 0;

CREATE TABLE  IF NOT EXISTS `files_frame_side_cells` (
  `frame_side_id` int unsigned NOT NULL,
  `file_id` int unsigned NOT NULL,
  `user_id` int unsigned NOT NULL,
  `cells` json DEFAULT NULL,
  `process_start_time` datetime DEFAULT NULL,
  `process_end_time` datetime DEFAULT NULL,
  `added_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`frame_side_id`, `file_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

SET SESSION sql_require_primary_key = 1;

INSERT INTO `files_frame_side_cells` (
  frame_side_id,
  file_id,
  user_id,
  cells,
  process_start_time,
  process_end_time,
  added_time
)
SELECT 
  frame_side_id,
  file_id,
  user_id,
  detected_frame_resources,
  process_start_time,
  process_end_time,
  added_time
FROM files_frame_side_rel;

ALTER TABLE `files_frame_side_rel` DROP `detected_frame_resources`;
