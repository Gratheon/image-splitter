CREATE TABLE IF NOT EXISTS `ai_advisor_usage_monthly` (
  `user_id` INT UNSIGNED NOT NULL,
  `usage_month` DATE NOT NULL,
  `input_tokens` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `output_tokens` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `total_tokens` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `request_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `usage_month`),
  KEY `idx_ai_advisor_usage_month` (`usage_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
