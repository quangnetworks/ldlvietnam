-- Nhãn hiển thị cho tài khoản có quyền Chủ doanh nghiệp (is_owner = 1). NULL = "Chủ doanh nghiệp".
-- Chỉ đổi cách hiển thị, quyền giữ nguyên. Chỉ thêm cột.
ALTER TABLE users ADD COLUMN owner_label TEXT;
