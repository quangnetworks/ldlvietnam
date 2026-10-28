-- Đếm nhanh số lần đăng nhập sai gần đây (giới hạn thử mật khẩu / mã xác thực). Chỉ thêm chỉ mục, không đổi dữ liệu.
CREATE INDEX IF NOT EXISTS idx_login_logs_fail_user ON login_logs(success, username, created_at);
CREATE INDEX IF NOT EXISTS idx_login_logs_fail_ip ON login_logs(success, ip, created_at);
