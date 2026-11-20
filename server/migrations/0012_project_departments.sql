-- Dự án phối hợp nhiều phòng ban
CREATE TABLE IF NOT EXISTS project_departments (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, department_id)
);
INSERT OR IGNORE INTO project_departments(project_id, department_id)
  SELECT id, department_id FROM projects WHERE department_id IS NOT NULL;
