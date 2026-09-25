-- Kết quả công việc: nội dung (văn bản), liên kết và tệp (ảnh, video, office...) cập nhật theo từng lần
CREATE TABLE IF NOT EXISTS task_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content TEXT,
  links TEXT, -- JSON: [{ "url": "...", "title": "..." }]
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_results_task ON task_results(task_id);

-- Tệp của kết quả dùng chung bảng tệp đính kèm công việc (xoá theo công việc như cũ)
ALTER TABLE task_attachments ADD COLUMN result_id INTEGER REFERENCES task_results(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_task_attachments_result ON task_attachments(result_id);
