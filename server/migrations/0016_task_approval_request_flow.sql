-- Wework: công việc của nhân viên phòng ban này cần cấp quản lý duyệt mới được "Hoàn thành"
ALTER TABLE departments ADD COLUMN task_approval INTEGER NOT NULL DEFAULT 0;

-- Request: luồng duyệt 3 chặng — Quản lý trực tiếp → Phòng ban liên quan → Người duyệt cuối cùng
ALTER TABLE request_groups ADD COLUMN manager_approval INTEGER NOT NULL DEFAULT 0;
ALTER TABLE request_groups ADD COLUMN final_approver_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE request_approvers ADD COLUMN stage TEXT;          -- manager | dept | final (NULL: đề xuất cũ)

-- Request: mẫu in (bản cứng / PDF) của nhóm đề xuất
ALTER TABLE request_groups ADD COLUMN print_title TEXT;       -- VD: GIẤY ĐỀ NGHỊ TẠM ỨNG
ALTER TABLE request_groups ADD COLUMN print_code TEXT;        -- VD: BM-KT-01
ALTER TABLE request_groups ADD COLUMN print_note TEXT;        -- ghi chú / cam kết cuối phiếu
ALTER TABLE requests ADD COLUMN submitted_at TEXT;
