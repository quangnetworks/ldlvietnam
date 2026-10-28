-- LDL Asset — tài sản đặt tại NPP / điểm bán (tủ mát, kệ trưng bày, biển hiệu, POSM, xe kéo…) và kiểm tra định kỳ tại chỗ.
-- Chỉ thêm cột / bảng mới, không thay đổi dữ liệu hiện có.
ALTER TABLE assets ADD COLUMN placement TEXT NOT NULL DEFAULT 'company';   -- company | market
ALTER TABLE assets ADD COLUMN partner TEXT;                                 -- NPP / đại lý cho mượn
ALTER TABLE assets ADD COLUMN outlet TEXT;                                  -- điểm bán / cửa hàng đặt tài sản
ALTER TABLE assets ADD COLUMN outlet_address TEXT;
ALTER TABLE assets ADD COLUMN area TEXT;                                    -- tỉnh / khu vực
ALTER TABLE assets ADD COLUMN placed_at TEXT;
ALTER TABLE assets ADD COLUMN agreement_until TEXT;                         -- hạn thoả thuận cho mượn
ALTER TABLE assets ADD COLUMN last_check_at TEXT;
ALTER TABLE assets ADD COLUMN last_check_result TEXT;
CREATE INDEX IF NOT EXISTS idx_assets_placement ON assets(placement, partner);

CREATE TABLE IF NOT EXISTS asset_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  result TEXT NOT NULL,                        -- ok | damaged | missing | moved
  condition TEXT,
  photo TEXT,
  lat REAL, lng REAL, accuracy INTEGER,
  note TEXT,
  checked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  checked_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_asset_checks_asset ON asset_checks(asset_id, id);
