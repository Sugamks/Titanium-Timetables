-- Academic year filter: classes belong to class.acad_year_id; subjects are linked per year from ttv2 workload.
ALTER TABLE section ADD COLUMN academic_year_id VARCHAR(36);

CREATE TABLE IF NOT EXISTS subject_year (
  id VARCHAR(36) PRIMARY KEY,
  subject_id VARCHAR(36) NOT NULL,
  academic_year_id VARCHAR(36) NOT NULL,
  UNIQUE (subject_id, academic_year_id)
);
