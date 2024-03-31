ALTER TABLE `files_frame_side_rel` 
	ADD `inspection_id` INT  NULL  DEFAULT NULL  AFTER `user_id`;

ALTER TABLE `files_frame_side_cells` 
	ADD `inspection_id` INT  NULL  DEFAULT NULL  AFTER `user_id`;

ALTER TABLE `files_frame_side_queen_cups` 
	ADD `inspection_id` INT  NULL  DEFAULT NULL  AFTER `user_id`;
