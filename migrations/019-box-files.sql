SET SESSION sql_require_primary_key = 0;

CREATE TABLE IF NOT EXISTS `files_box_rel` (
                                 `box_id` int unsigned NOT NULL,
                                 `file_id` int unsigned NOT NULL,
                                 `user_id` int unsigned NOT NULL,
                                 `inspection_id` INT NULL DEFAULT NULL,
                                 `added_time` datetime DEFAULT CURRENT_TIMESTAMP,
                                 PRIMARY KEY (`box_id`, `file_id`),
                                 INDEX (`user_id`, `box_id`, `inspection_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

SET SESSION sql_require_primary_key = 1;

