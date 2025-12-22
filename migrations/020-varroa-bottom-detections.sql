CREATE TABLE `varroa_bottom_detections` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `file_id` int unsigned NOT NULL,
  `box_id` int unsigned NOT NULL,
  `user_id` int unsigned NOT NULL,
  `varroa_count` int NOT NULL DEFAULT 0,
  `detections` JSON NULL,
  `model_version` varchar(50) DEFAULT 'yolov11-nano',
  `processed_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `file_detection` (`file_id`),
  KEY `user_box` (`user_id`, `box_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

