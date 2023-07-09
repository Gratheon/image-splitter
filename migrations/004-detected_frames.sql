/* 13:25:56 local image-splitter */ ALTER TABLE `files_frame_side_rel` CHANGE `detectedObjects` `detected_bees` JSON  NULL  DEFAULT NULL;

/* 13:26:51 local image-splitter */ ALTER TABLE `files_frame_side_rel` ADD `detected_frame_resources` JSON  NULL  AFTER `detected_bees`;
