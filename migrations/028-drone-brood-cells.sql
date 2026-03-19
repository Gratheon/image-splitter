ALTER TABLE `files_frame_side_cells`
	ADD COLUMN IF NOT EXISTS `nectar` INT NULL DEFAULT NULL AFTER `eggs`,
	ADD COLUMN IF NOT EXISTS `drone_brood_cell_count` INT NULL DEFAULT NULL AFTER `nectar_cell_count`,
	ADD COLUMN IF NOT EXISTS `drone_brood` INT NULL DEFAULT NULL AFTER `nectar`;
