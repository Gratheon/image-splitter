ALTER TABLE user_detection_settings
  ADD COLUMN bees_confidence_percent TINYINT UNSIGNED NULL,
  ADD COLUMN drones_confidence_percent TINYINT UNSIGNED NULL,
  ADD COLUMN queens_confidence_percent TINYINT UNSIGNED NULL,
  ADD COLUMN queen_cups_confidence_percent TINYINT UNSIGNED NULL,
  ADD COLUMN varroa_confidence_percent TINYINT UNSIGNED NULL;

UPDATE user_detection_settings
SET
  bees_confidence_percent = COALESCE(bees_confidence_percent, min_confidence_percent, 60),
  drones_confidence_percent = COALESCE(drones_confidence_percent, min_confidence_percent, 60),
  queens_confidence_percent = COALESCE(queens_confidence_percent, min_confidence_percent, 60),
  queen_cups_confidence_percent = COALESCE(queen_cups_confidence_percent, min_confidence_percent, 60),
  varroa_confidence_percent = COALESCE(varroa_confidence_percent, min_confidence_percent, 60);
