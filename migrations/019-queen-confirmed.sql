-- Add a column to store user confirmation of queen presence
ALTER TABLE `files_frame_side_rel`
ADD COLUMN `is_queen_confirmed` BOOLEAN NOT NULL DEFAULT FALSE;
