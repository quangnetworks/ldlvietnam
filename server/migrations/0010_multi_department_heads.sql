-- Một tài khoản thuộc nhiều phòng ban: phòng ban chính = users.department_id, phòng ban kiêm nhiệm ở bảng này
CREATE TABLE IF NOT EXISTS user_departments (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, department_id)
);
CREATE INDEX IF NOT EXISTS idx_user_departments_dep ON user_departments(department_id);

-- Trưởng phòng: được giao việc cho mọi nhân sự thuộc phòng ban
ALTER TABLE departments ADD COLUMN head_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
