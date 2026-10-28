-- ================= Cơ cấu kinh doanh theo ngành hàng (Hóa mỹ phẩm / Thực phẩm) và 3 miền Bắc / Trung / Nam =================
-- Ngành hàng của từng phân công; NULL = phụ trách chung cả các ngành (VD NSM chung)
ALTER TABLE territory_members ADD COLUMN industry TEXT;
-- Ngành hàng chính của nhân sự (theo phân công chính), dùng hiển thị / lọc nhanh
ALTER TABLE users ADD COLUMN sales_industry TEXT;

-- Tách "Miền Trung Nam" (mặc định của 0022) thành Miền Trung và Miền Nam — chỉ khi địa bàn mặc định chưa bị đổi tên
INSERT INTO territories(name, code, level, parent_id, sort)
  SELECT 'Miền Trung', 'MT', 'region', 1, 2
  WHERE EXISTS (SELECT 1 FROM territories WHERE id = 3 AND name = 'Miền Trung Nam')
    AND NOT EXISTS (SELECT 1 FROM territories WHERE level = 'region' AND name = 'Miền Trung');
UPDATE territories SET parent_id = (SELECT id FROM territories WHERE level = 'region' AND name = 'Miền Trung' LIMIT 1)
  WHERE level = 'area' AND code IN ('BMT', 'NMT') AND parent_id = 3
    AND EXISTS (SELECT 1 FROM territories WHERE id = 3 AND name = 'Miền Trung Nam');
UPDATE territories SET name = 'Miền Nam', code = 'MN', sort = 3 WHERE id = 3 AND name = 'Miền Trung Nam';
