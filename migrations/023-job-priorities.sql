-- Add priority column to jobs table for queue prioritization
-- Lower number = higher priority
-- 1 = High (user-blocking operations like resize)
-- 3 = Medium (local AI processing)
-- 5 = Low (external API calls)

ALTER TABLE jobs 
ADD COLUMN priority TINYINT NOT NULL DEFAULT 5 AFTER payload;

-- Add index for efficient priority-based job fetching
-- This index supports the query in fetchUnprocessed that orders by priority, id
ALTER TABLE jobs 
ADD INDEX idx_priority_queue (name, priority ASC, process_start_time, process_end_time, calls);
