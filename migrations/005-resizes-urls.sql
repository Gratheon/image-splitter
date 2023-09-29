ALTER TABLE `files` ADD `url_version` INT  NOT NULL  DEFAULT '1';

CREATE TABLE `files_resized` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `file_id` int DEFAULT NULL,
  `max_dimension_px` int DEFAULT '1024',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;