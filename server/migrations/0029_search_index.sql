-- Tìm kiếm toàn hệ thống (FTS5). Chữ được chuẩn hoá ở ứng dụng (bỏ dấu, đ→d, chữ thường, bỏ HTML) trước khi
-- đưa vào chỉ mục — xem server/src/search.js. rowid = mã loại × 10^10 + id bản ghi.
-- Trigger dùng "thêm nếu chưa có" (không dùng OR IGNORE: câu lệnh UPSERT bên ngoài sẽ ghi đè cách xử lý xung đột của trigger).
-- Trigger chỉ ghi "bản ghi cần lập lại chỉ mục" vào search_queue; ứng dụng xử lý hàng đợi trước mỗi lần tìm.
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(title, body, tokenize = 'unicode61');
CREATE TABLE IF NOT EXISTS search_queue (rid INTEGER PRIMARY KEY);

-- document (documents)
CREATE TRIGGER IF NOT EXISTS search_documents_ai AFTER INSERT ON documents BEGIN INSERT INTO search_queue(rid) SELECT 10000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 10000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_documents_au AFTER UPDATE OF title, code, description, content, sender_org, type_id, deleted_at ON documents BEGIN INSERT INTO search_queue(rid) SELECT 10000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 10000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_documents_ad AFTER DELETE ON documents BEGIN INSERT INTO search_queue(rid) SELECT 10000000000 + OLD.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 10000000000 + OLD.id); END;
INSERT OR IGNORE INTO search_queue(rid) SELECT 10000000000 + id FROM documents;

-- task (tasks)
CREATE TRIGGER IF NOT EXISTS search_tasks_ai AFTER INSERT ON tasks BEGIN INSERT INTO search_queue(rid) SELECT 20000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 20000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_tasks_au AFTER UPDATE OF title, description ON tasks BEGIN INSERT INTO search_queue(rid) SELECT 20000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 20000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_tasks_ad AFTER DELETE ON tasks BEGIN INSERT INTO search_queue(rid) SELECT 20000000000 + OLD.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 20000000000 + OLD.id); END;
INSERT OR IGNORE INTO search_queue(rid) SELECT 20000000000 + id FROM tasks;

-- project (projects)
CREATE TRIGGER IF NOT EXISTS search_projects_ai AFTER INSERT ON projects BEGIN INSERT INTO search_queue(rid) SELECT 30000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 30000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_projects_au AFTER UPDATE OF name, description ON projects BEGIN INSERT INTO search_queue(rid) SELECT 30000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 30000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_projects_ad AFTER DELETE ON projects BEGIN INSERT INTO search_queue(rid) SELECT 30000000000 + OLD.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 30000000000 + OLD.id); END;
INSERT OR IGNORE INTO search_queue(rid) SELECT 30000000000 + id FROM projects;

-- goal (goals)
CREATE TRIGGER IF NOT EXISTS search_goals_ai AFTER INSERT ON goals BEGIN INSERT INTO search_queue(rid) SELECT 40000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 40000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_goals_au AFTER UPDATE OF title, description ON goals BEGIN INSERT INTO search_queue(rid) SELECT 40000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 40000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_goals_ad AFTER DELETE ON goals BEGIN INSERT INTO search_queue(rid) SELECT 40000000000 + OLD.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 40000000000 + OLD.id); END;
INSERT OR IGNORE INTO search_queue(rid) SELECT 40000000000 + id FROM goals;

-- request (requests)
CREATE TRIGGER IF NOT EXISTS search_requests_ai AFTER INSERT ON requests BEGIN INSERT INTO search_queue(rid) SELECT 50000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 50000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_requests_au AFTER UPDATE OF title, content, data ON requests BEGIN INSERT INTO search_queue(rid) SELECT 50000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 50000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_requests_ad AFTER DELETE ON requests BEGIN INSERT INTO search_queue(rid) SELECT 50000000000 + OLD.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 50000000000 + OLD.id); END;
INSERT OR IGNORE INTO search_queue(rid) SELECT 50000000000 + id FROM requests;

-- drive (drive_items)
CREATE TRIGGER IF NOT EXISTS search_drive_items_ai AFTER INSERT ON drive_items BEGIN INSERT INTO search_queue(rid) SELECT 60000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 60000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_drive_items_au AFTER UPDATE OF name ON drive_items BEGIN INSERT INTO search_queue(rid) SELECT 60000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 60000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_drive_items_ad AFTER DELETE ON drive_items BEGIN INSERT INTO search_queue(rid) SELECT 60000000000 + OLD.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 60000000000 + OLD.id); END;
INSERT OR IGNORE INTO search_queue(rid) SELECT 60000000000 + id FROM drive_items;

-- user (users)
CREATE TRIGGER IF NOT EXISTS search_users_ai AFTER INSERT ON users BEGIN INSERT INTO search_queue(rid) SELECT 70000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 70000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_users_au AFTER UPDATE OF name, username, email, phone, title ON users BEGIN INSERT INTO search_queue(rid) SELECT 70000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 70000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_users_ad AFTER DELETE ON users BEGIN INSERT INTO search_queue(rid) SELECT 70000000000 + OLD.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 70000000000 + OLD.id); END;
INSERT OR IGNORE INTO search_queue(rid) SELECT 70000000000 + id FROM users;

-- asset (assets)
CREATE TRIGGER IF NOT EXISTS search_assets_ai AFTER INSERT ON assets BEGIN INSERT INTO search_queue(rid) SELECT 80000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 80000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_assets_au AFTER UPDATE OF name, code, serial, location, supplier, note ON assets BEGIN INSERT INTO search_queue(rid) SELECT 80000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 80000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_assets_ad AFTER DELETE ON assets BEGIN INSERT INTO search_queue(rid) SELECT 80000000000 + OLD.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 80000000000 + OLD.id); END;
INSERT OR IGNORE INTO search_queue(rid) SELECT 80000000000 + id FROM assets;

-- chat (chat_messages)
CREATE TRIGGER IF NOT EXISTS search_chat_messages_ai AFTER INSERT ON chat_messages BEGIN INSERT INTO search_queue(rid) SELECT 90000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 90000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_chat_messages_au AFTER UPDATE OF content, original_name, deleted_at ON chat_messages BEGIN INSERT INTO search_queue(rid) SELECT 90000000000 + NEW.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 90000000000 + NEW.id); END;
CREATE TRIGGER IF NOT EXISTS search_chat_messages_ad AFTER DELETE ON chat_messages BEGIN INSERT INTO search_queue(rid) SELECT 90000000000 + OLD.id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 90000000000 + OLD.id); END;
INSERT OR IGNORE INTO search_queue(rid) SELECT 90000000000 + id FROM chat_messages;

-- Hồ sơ nhân sự (mã nhân viên, văn phòng, vị trí) thuộc chỉ mục của người dùng
CREATE TRIGGER IF NOT EXISTS search_hr_profiles_ai AFTER INSERT ON hr_profiles BEGIN INSERT INTO search_queue(rid) SELECT 70000000000 + NEW.user_id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 70000000000 + NEW.user_id); END;
CREATE TRIGGER IF NOT EXISTS search_hr_profiles_au AFTER UPDATE OF employee_code, office, job_position ON hr_profiles BEGIN INSERT INTO search_queue(rid) SELECT 70000000000 + NEW.user_id WHERE NOT EXISTS (SELECT 1 FROM search_queue WHERE rid = 70000000000 + NEW.user_id); END;
