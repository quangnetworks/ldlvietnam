-- Ảnh / tệp đính kèm trong bình luận (dùng chung cho Wework, Request, Office)
CREATE TABLE IF NOT EXISTS comment_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,            -- 'task' | 'request' | 'document'
  entity_id INTEGER NOT NULL,
  comment_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comment_files_comment ON comment_files(entity, comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_files_entity ON comment_files(entity, entity_id);
