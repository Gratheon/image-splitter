ALTER TABLE user_detection_settings
  ADD COLUMN min_confidence_percent TINYINT UNSIGNED NOT NULL DEFAULT 60;

UPDATE user_detection_settings
SET min_confidence_percent = CASE UPPER(COALESCE(sensitivity, 'BALANCED'))
  WHEN 'STRICT' THEN 80
  WHEN 'SENSITIVE' THEN 40
  ELSE 60
END;
