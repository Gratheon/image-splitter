-- Postgres baseline for image-splitter.
-- WHY: the service moved from MySQL to Postgres. The previous 29 MySQL migrations relied on
-- MySQL-only features (PREPARE/SET @var, ALTER ... AFTER, ENUM, ON UPDATE CURRENT_TIMESTAMP) and
-- had drifted from production (primary keys were added by hand, files were renamed and re-run),
-- so they were replaced by this single schema that mirrors the final MySQL production schema.
-- Production data was copied by scripts/migrate-mysql-to-postgres.js.
-- Never edit this file after it is applied: add a new numbered migration instead.
--
-- Type mapping: INT UNSIGNED ids -> INTEGER (all ids are far below 2^31), AUTO_INCREMENT -> SERIAL,
-- TINYINT(1) -> BOOLEAN, TINYINT -> SMALLINT, JSON -> JSONB, DATETIME -> TIMESTAMPTZ (MySQL ran in UTC),
-- MEDIUMTEXT -> TEXT. Duplicate MySQL indexes were dropped.

-- Uploaded images. url_version 1 = legacy flat S3 key, 2 = {user_id}/{hash}/original.{ext}
CREATE TABLE IF NOT EXISTS files (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  hash VARCHAR(64) NOT NULL DEFAULT '',
  ext VARCHAR(5) NOT NULL,
  filename VARCHAR(255) DEFAULT NULL,
  width INTEGER DEFAULT NULL,
  height INTEGER DEFAULT NULL,
  url_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS files_resized (
  id SERIAL PRIMARY KEY,
  file_id INTEGER DEFAULT NULL,
  max_dimension_px INTEGER DEFAULT 1024
);
-- getResizes() joins by file_id
CREATE INDEX IF NOT EXISTS idx_files_resized_file ON files_resized (file_id);

CREATE TABLE IF NOT EXISTS files_hive_rel (
  hive_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (hive_id, file_id)
);
CREATE INDEX IF NOT EXISTS idx_files_hive_rel_file ON files_hive_rel (file_id);

CREATE TABLE IF NOT EXISTS files_box_rel (
  box_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  inspection_id INTEGER DEFAULT NULL,
  added_time TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (box_id, file_id)
);
CREATE INDEX IF NOT EXISTS idx_files_box_rel_user_box ON files_box_rel (user_id, box_id, inspection_id);
CREATE INDEX IF NOT EXISTS idx_files_box_rel_file ON files_box_rel (file_id);

-- Frame side photo with bee/drone/varroa/queen detections.
-- "strokeHistory" keeps its camelCase name, so it must always be double-quoted in queries.
CREATE TABLE IF NOT EXISTS files_frame_side_rel (
  frame_side_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  inspection_id INTEGER DEFAULT NULL,
  "strokeHistory" JSONB DEFAULT NULL,
  added_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  worker_bee_count INTEGER DEFAULT NULL,
  drone_count INTEGER DEFAULT NULL,
  queen_count INTEGER DEFAULT NULL,
  varroa_count INTEGER DEFAULT NULL,
  detected_bees JSONB DEFAULT NULL,
  detected_drones JSONB DEFAULT NULL,
  detected_varroa JSONB DEFAULT NULL,
  detected_queens JSONB DEFAULT NULL,
  queen_detected BOOLEAN NOT NULL DEFAULT FALSE,
  is_queen_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (frame_side_id, file_id)
);
CREATE INDEX IF NOT EXISTS idx_files_frame_side_rel_user ON files_frame_side_rel (user_id, frame_side_id, inspection_id);
CREATE INDEX IF NOT EXISTS idx_files_frame_side_rel_file ON files_frame_side_rel (file_id);

CREATE TABLE IF NOT EXISTS files_frame_side_cells (
  frame_side_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  inspection_id INTEGER DEFAULT NULL,
  cells JSONB DEFAULT NULL,
  honey_cell_count INTEGER DEFAULT NULL,
  brood_cell_count INTEGER DEFAULT NULL,
  egg_cell_count INTEGER DEFAULT NULL,
  capped_brood_cell_count INTEGER DEFAULT NULL,
  pollen_cell_count INTEGER DEFAULT NULL,
  nectar_cell_count INTEGER DEFAULT NULL,
  drone_brood_cell_count INTEGER DEFAULT NULL,
  empty_cell_count INTEGER DEFAULT NULL,
  added_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- relative counts, percent of all detected cells
  brood INTEGER DEFAULT NULL,
  capped_brood INTEGER DEFAULT NULL,
  eggs INTEGER DEFAULT NULL,
  nectar INTEGER DEFAULT NULL,
  drone_brood INTEGER DEFAULT NULL,
  pollen INTEGER DEFAULT NULL,
  honey INTEGER DEFAULT NULL,
  PRIMARY KEY (frame_side_id, file_id)
);
CREATE INDEX IF NOT EXISTS idx_files_frame_side_cells_user ON files_frame_side_cells (user_id, frame_side_id, inspection_id);
CREATE INDEX IF NOT EXISTS idx_files_frame_side_cells_file ON files_frame_side_cells (file_id);

CREATE TABLE IF NOT EXISTS files_frame_side_queen_cups (
  frame_side_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  inspection_id INTEGER DEFAULT NULL,
  cups JSONB DEFAULT NULL,
  added_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (frame_side_id, file_id)
);
CREATE INDEX IF NOT EXISTS idx_files_frame_side_queen_cups_user ON files_frame_side_queen_cups (user_id, frame_side_id, inspection_id);
CREATE INDEX IF NOT EXISTS idx_files_frame_side_queen_cups_file ON files_frame_side_queen_cups (file_id);

CREATE TABLE IF NOT EXISTS hive_advice (
  id SERIAL PRIMARY KEY,
  hive_id INTEGER DEFAULT NULL,
  user_id INTEGER DEFAULT NULL,
  question TEXT,
  answer TEXT,
  added_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hive_advice_hive ON hive_advice (hive_id);

-- Async job queue (source of truth; Redis pub/sub only wakes the workers up)
CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  process_start_time TIMESTAMPTZ DEFAULT NULL,
  last_retry_time TIMESTAMPTZ DEFAULT NULL,
  calls INTEGER DEFAULT 0,
  process_end_time TIMESTAMPTZ DEFAULT NULL,
  ref_id INTEGER DEFAULT NULL,
  payload JSONB DEFAULT NULL,
  -- lower number = higher priority: 1 user-blocking (resize), 3 local AI, 5 external APIs
  priority SMALLINT NOT NULL DEFAULT 5,
  error TEXT
);
-- fetchUnprocessed(): oldest open job of a type by priority
CREATE INDEX IF NOT EXISTS idx_jobs_priority_queue ON jobs (name, priority, process_start_time, process_end_time, calls);
-- startDetection/endDetection/isComplete look jobs up by (name, ref_id)
CREATE INDEX IF NOT EXISTS idx_jobs_ref ON jobs (ref_id, name);

CREATE TABLE IF NOT EXISTS user_detection_settings (
  user_id BIGINT PRIMARY KEY,
  sensitivity VARCHAR(16) NOT NULL DEFAULT 'BALANCED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- MySQL used ON UPDATE CURRENT_TIMESTAMP; the only write path (upsert) sets it explicitly
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  min_confidence_percent SMALLINT NOT NULL DEFAULT 60,
  bees_confidence_percent SMALLINT DEFAULT NULL,
  drones_confidence_percent SMALLINT DEFAULT NULL,
  queens_confidence_percent SMALLINT DEFAULT NULL,
  queen_cups_confidence_percent SMALLINT DEFAULT NULL,
  varroa_confidence_percent SMALLINT DEFAULT NULL,
  varroa_bottom_confidence_percent SMALLINT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS varroa_bottom_detections (
  id SERIAL PRIMARY KEY,
  file_id INTEGER NOT NULL,
  box_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  varroa_count INTEGER NOT NULL DEFAULT 0,
  detections JSONB DEFAULT NULL,
  model_version VARCHAR(50) DEFAULT 'yolov11-nano',
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  -- target of the ON CONFLICT upsert in boxFile.updateVarroaDetections()
  CONSTRAINT varroa_bottom_detections_file_unique UNIQUE (file_id)
);
CREATE INDEX IF NOT EXISTS idx_varroa_bottom_detections_user_box ON varroa_bottom_detections (user_id, box_id);
