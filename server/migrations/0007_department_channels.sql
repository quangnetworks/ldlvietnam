-- Kênh chat nhóm theo phòng ban (thành viên = nhân sự thuộc phòng ban, tự cập nhật theo phòng ban của tài khoản)
ALTER TABLE chat_channels ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE;

INSERT INTO chat_channels(name, description, kind, department_id)
SELECT d.name, 'Kênh trao đổi nội bộ ' || d.name, 'department', d.id FROM departments d
WHERE NOT EXISTS (SELECT 1 FROM chat_channels c WHERE c.kind = 'department' AND c.department_id = d.id);
