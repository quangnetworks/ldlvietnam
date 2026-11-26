-- Thử việc theo Bộ luật Lao động 2019 (Điều 24–25): nhóm công việc quyết định thời gian thử việc tối đa
-- manager: người quản lý doanh nghiệp (≤ 180 ngày) | college: cao đẳng trở lên (≤ 60 ngày)
-- intermediate: trung cấp, công nhân kỹ thuật, nhân viên nghiệp vụ (≤ 30 ngày) | other: công việc khác (≤ 6 ngày làm việc)
ALTER TABLE hr_profiles ADD COLUMN probation_level TEXT;

-- Đề xuất gia hạn thử việc (trong giới hạn luật), cần Quản lý nhân sự duyệt
CREATE TABLE IF NOT EXISTS hr_probation_extensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_end TEXT,
  new_end TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | approved | rejected | cancelled
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_probation_ext_user ON hr_probation_extensions(user_id);
CREATE INDEX IF NOT EXISTS idx_hr_probation_ext_status ON hr_probation_extensions(status);

-- Nhắc việc HRM đã gửi (hạn đánh giá thử việc, hợp đồng sắp hết hạn, hồ sơ nhận lương còn thiếu) — mỗi mốc chỉ nhắc một lần
CREATE TABLE IF NOT EXISTS hr_reminders (
  key TEXT PRIMARY KEY,
  sent_at TEXT DEFAULT (datetime('now'))
);
