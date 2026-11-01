-- Soft-delete scheduling templates without dropping grids or versions.
ALTER TABLE timetable ADD COLUMN deleted_at DATETIME;
