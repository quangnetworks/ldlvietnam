-- Trả lời bình luận (một cấp: trả lời gắn vào bình luận gốc)
ALTER TABLE task_comments ADD COLUMN parent_id INTEGER;
ALTER TABLE request_comments ADD COLUMN parent_id INTEGER;
ALTER TABLE document_comments ADD COLUMN parent_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_task_comments_parent ON task_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_request_comments_parent ON request_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_document_comments_parent ON document_comments(parent_id);
