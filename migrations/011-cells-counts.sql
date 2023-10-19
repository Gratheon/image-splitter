/* 18:39:36 local image-splitter */ ALTER TABLE `files_frame_side_cells` ADD `honey_cell_count` INT  NULL  DEFAULT NULL  AFTER `cells`;
/* 18:40:36 local image-splitter */ ALTER TABLE `files_frame_side_cells` ADD `brood_cell_count` INT  NULL  DEFAULT NULL  AFTER `honey_cell_count`;
/* 18:41:07 local image-splitter */ ALTER TABLE `files_frame_side_cells` ADD `egg_cell_count` INT  NULL  DEFAULT NULL  AFTER `brood_cell_count`;
/* 18:41:29 local image-splitter */ ALTER TABLE `files_frame_side_cells` ADD `capped_brood_cell_count` INT  NULL  DEFAULT NULL  AFTER `egg_cell_count`;
/* 18:41:43 local image-splitter */ ALTER TABLE `files_frame_side_cells` ADD `pollen_cell_count` INT  NULL  DEFAULT NULL  AFTER `capped_brood_cell_count`;
/* 18:41:43 local image-splitter */ ALTER TABLE `files_frame_side_cells` ADD `nectar_cell_count` INT  NULL  DEFAULT NULL  AFTER `pollen_cell_count`;
/* 18:41:43 local image-splitter */ ALTER TABLE `files_frame_side_cells` ADD `empty_cell_count` INT  NULL  DEFAULT NULL  AFTER `nectar_cell_count`;



ALTER TABLE `files_frame_side_cells` ADD `brood` int DEFAULT NULL;
ALTER TABLE `files_frame_side_cells` ADD `capped_brood` int DEFAULT NULL;
ALTER TABLE `files_frame_side_cells` ADD `eggs` int DEFAULT NULL;
ALTER TABLE `files_frame_side_cells` ADD `pollen` int DEFAULT NULL;
ALTER TABLE `files_frame_side_cells` ADD `honey` int DEFAULT NULL;

ALTER TABLE `files_frame_side_rel` ADD `queen_detected` tinyint(1) NOT NULL DEFAULT '0';