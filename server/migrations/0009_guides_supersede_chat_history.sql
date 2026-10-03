-- LDL Request: biểu mẫu / quy trình hướng dẫn gắn với nhóm đề xuất
ALTER TABLE request_groups ADD COLUMN guide TEXT; -- hướng dẫn thực hiện (HTML)
CREATE TABLE IF NOT EXISTS request_group_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES request_groups(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'form', -- form = biểu mẫu, process = quy trình / hướng dẫn
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_request_group_files ON request_group_files(group_id);

-- LDL Office: văn bản mới thay thế văn bản / chính sách cũ
ALTER TABLE documents ADD COLUMN replaces_id INTEGER REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN superseded_by INTEGER REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN superseded_at TEXT; -- ngày văn bản thay thế có hiệu lực
CREATE INDEX IF NOT EXISTS idx_documents_replaces ON documents(replaces_id);

-- LDL Message: thành viên chỉ xem tin nhắn có id > history_from_id (0 = xem toàn bộ lịch sử)
ALTER TABLE chat_members ADD COLUMN history_from_id INTEGER NOT NULL DEFAULT 0;
