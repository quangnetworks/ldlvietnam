-- Sửa bình luận: thời điểm sửa gần nhất (hiện nhãn "đã sửa")
ALTER TABLE task_comments ADD COLUMN updated_at TEXT;
ALTER TABLE request_comments ADD COLUMN updated_at TEXT;
ALTER TABLE document_comments ADD COLUMN updated_at TEXT;
