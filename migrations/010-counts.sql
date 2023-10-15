/* 03:23:48 local image-splitter */ ALTER TABLE `files_frame_side_rel` ADD `worker_bee_count` INT  NULL  DEFAULT NULL  AFTER `added_time`;
/* 03:23:55 local image-splitter */ ALTER TABLE `files_frame_side_rel` ADD `drone_count` INT  NULL  DEFAULT NULL  AFTER `worker_bee_count`;
/* 03:23:57 local image-splitter */ ALTER TABLE `files_frame_side_rel` ADD `queen_count` INT  NULL  DEFAULT NULL  AFTER `drone_count`;
