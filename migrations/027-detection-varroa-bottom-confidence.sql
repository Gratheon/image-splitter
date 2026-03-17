ALTER TABLE user_detection_settings
  ADD COLUMN varroa_bottom_confidence_percent TINYINT UNSIGNED NULL;

UPDATE user_detection_settings
SET varroa_bottom_confidence_percent = COALESCE(varroa_bottom_confidence_percent, min_confidence_percent, 60);
