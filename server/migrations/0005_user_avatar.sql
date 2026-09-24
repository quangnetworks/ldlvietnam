-- Ảnh đại diện người dùng (tệp lưu trong kho tệp: thư mục uploads / R2)
ALTER TABLE users ADD COLUMN avatar TEXT;
ALTER TABLE users ADD COLUMN avatar_version INTEGER NOT NULL DEFAULT 0;
