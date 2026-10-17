-- "Chủ doanh nghiệp": cấp quản trị cao nhất, đứng trên Quản trị hệ thống.
-- Vẫn giữ role = 'admin' để có toàn quyền; cờ is_owner bảo vệ tài khoản khỏi bị quản trị viên khác sửa / khoá.
ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;
