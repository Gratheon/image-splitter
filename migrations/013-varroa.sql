/* 23:07:34 local image-splitter */ ALTER TABLE `files_frame_side_rel` ADD `detected_varroa` JSON  NULL  AFTER `detected_bees`;
/* 23:08:16 local image-splitter */ ALTER TABLE `files_frame_side_rel` ADD `varroa_count` INT  NULL  DEFAULT NULL  AFTER `queen_count`;
