-- Scheduling Model 2.0: groups, combined classes, availability, qualifications.
ALTER TABLE student_group ADD COLUMN section_id VARCHAR(36);
ALTER TABLE student_group ADD COLUMN kind VARCHAR(16);
ALTER TABLE teacher ADD COLUMN contract_min INTEGER;
ALTER TABLE teacher ADD COLUMN contract_max INTEGER;
ALTER TABLE section ADD COLUMN home_room_id VARCHAR(36);
ALTER TABLE lesson ADD COLUMN priority INTEGER;
ALTER TABLE lesson ADD COLUMN required_room_type VARCHAR(40);
ALTER TABLE lesson ADD COLUMN locked BOOLEAN;
ALTER TABLE lesson ADD COLUMN allow_unqualified BOOLEAN;

CREATE TABLE IF NOT EXISTS lesson_section (
  id VARCHAR(36) PRIMARY KEY,
  lesson_id VARCHAR(36) NOT NULL,
  section_id VARCHAR(36) NOT NULL,
  UNIQUE (lesson_id, section_id)
);

CREATE TABLE IF NOT EXISTS lesson_group (
  id VARCHAR(36) PRIMARY KEY,
  lesson_id VARCHAR(36) NOT NULL,
  student_group_id VARCHAR(36) NOT NULL,
  UNIQUE (lesson_id, student_group_id)
);

CREATE TABLE IF NOT EXISTS teacher_subject (
  id VARCHAR(36) PRIMARY KEY,
  teacher_id VARCHAR(36) NOT NULL,
  subject_id VARCHAR(36) NOT NULL,
  qualified BOOLEAN,
  UNIQUE (teacher_id, subject_id)
);

CREATE TABLE IF NOT EXISTS availability_cell (
  id VARCHAR(36) PRIMARY KEY,
  resource_id VARCHAR(36) NOT NULL,
  day_id VARCHAR(36) NOT NULL,
  period_id VARCHAR(36) NOT NULL,
  week_pattern_id VARCHAR(36),
  state VARCHAR(16) NOT NULL,
  UNIQUE (resource_id, day_id, period_id, week_pattern_id)
);
