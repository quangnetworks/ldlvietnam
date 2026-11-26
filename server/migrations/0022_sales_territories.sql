-- ================= Cơ cấu kinh doanh theo địa bàn: NSM (Toàn quốc) → RSM (Miền) → ASM (Khu vực) → SS (Tỉnh) → PG / SREP / SREP KA =================
CREATE TABLE IF NOT EXISTS territories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  level TEXT NOT NULL,                        -- national | region | area | province
  parent_id INTEGER REFERENCES territories(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_territories_parent ON territories(parent_id);

-- Người phụ trách địa bàn theo vị trí; is_concurrent = kiêm nhiệm (một người có thể phụ trách nhiều địa bàn)
CREATE TABLE IF NOT EXISTS territory_members (
  territory_id INTEGER NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                         -- NSM | RSM | ASM | SS | PG | SREP | SREP_KA
  is_concurrent INTEGER NOT NULL DEFAULT 0,
  since TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (territory_id, user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_territory_members_user ON territory_members(user_id);

-- Vị trí kinh doanh chính của nhân sự (hiển thị, lọc nhanh)
ALTER TABLE users ADD COLUMN sales_role TEXT;

-- Duyệt đề xuất qua nhiều cấp quản lý (VD SS → ASM → RSM): số cấp quản lý trực tiếp duyệt ở chặng 1
ALTER TABLE request_groups ADD COLUMN manager_levels INTEGER NOT NULL DEFAULT 1;

-- Khung địa bàn mặc định (chỉnh sửa được trong LDL HRM → Cơ cấu kinh doanh); chỉ tạo khi chưa có
INSERT INTO territories(id, name, code, level, parent_id, sort)
  SELECT 1, 'Toàn quốc', 'VN', 'national', NULL, 0 WHERE NOT EXISTS (SELECT 1 FROM territories);
INSERT INTO territories(id, name, code, level, parent_id, sort) SELECT 2, 'Miền Bắc', 'MB', 'region', 1, 1 WHERE EXISTS (SELECT 1 FROM territories WHERE id = 1) AND NOT EXISTS (SELECT 1 FROM territories WHERE id = 2);
INSERT INTO territories(id, name, code, level, parent_id, sort) SELECT 3, 'Miền Trung Nam', 'MTN', 'region', 1, 2 WHERE EXISTS (SELECT 1 FROM territories WHERE id = 1) AND NOT EXISTS (SELECT 1 FROM territories WHERE id = 3);
INSERT INTO territories(name, code, level, parent_id, sort) SELECT 'Hà Nội', 'HN', 'area', 2, 1 WHERE NOT EXISTS (SELECT 1 FROM territories WHERE level = 'area');
INSERT INTO territories(name, code, level, parent_id, sort) SELECT 'Nam Hà Nội', 'NHN', 'area', 2, 2 WHERE (SELECT COUNT(*) FROM territories WHERE level = 'area') = 1;
INSERT INTO territories(name, code, level, parent_id, sort) SELECT 'Đông Tây Bắc', 'DTB', 'area', 2, 3 WHERE (SELECT COUNT(*) FROM territories WHERE level = 'area') = 2;
INSERT INTO territories(name, code, level, parent_id, sort) SELECT 'Duyên Hải', 'DH', 'area', 2, 4 WHERE (SELECT COUNT(*) FROM territories WHERE level = 'area') = 3;
INSERT INTO territories(name, code, level, parent_id, sort) SELECT 'Bắc Miền Trung', 'BMT', 'area', 3, 5 WHERE (SELECT COUNT(*) FROM territories WHERE level = 'area') = 4;
INSERT INTO territories(name, code, level, parent_id, sort) SELECT 'Nam Miền Trung', 'NMT', 'area', 3, 6 WHERE (SELECT COUNT(*) FROM territories WHERE level = 'area') = 5;
INSERT INTO territories(name, code, level, parent_id, sort) SELECT 'Đông Nam Bộ', 'DNB', 'area', 3, 7 WHERE (SELECT COUNT(*) FROM territories WHERE level = 'area') = 6;
INSERT INTO territories(name, code, level, parent_id, sort) SELECT 'Hồ Chí Minh', 'HCM', 'area', 3, 8 WHERE (SELECT COUNT(*) FROM territories WHERE level = 'area') = 7;
INSERT INTO territories(name, code, level, parent_id, sort) SELECT 'Bắc Mekong', 'BMK', 'area', 3, 9 WHERE (SELECT COUNT(*) FROM territories WHERE level = 'area') = 8;
INSERT INTO territories(name, code, level, parent_id, sort) SELECT 'Nam Mekong', 'NMK', 'area', 3, 10 WHERE (SELECT COUNT(*) FROM territories WHERE level = 'area') = 9;
