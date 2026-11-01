-- Timetable template columns. Applied by ensure_schema for existing SQLite files.
ALTER TABLE timetable ADD COLUMN description TEXT;
ALTER TABLE timetable ADD COLUMN status VARCHAR(24);
ALTER TABLE timetable ADD COLUMN is_disabled BOOLEAN;
ALTER TABLE timetable ADD COLUMN template_type VARCHAR(24);
