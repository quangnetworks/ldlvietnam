-- LDL Asset — nối với LDL Request (tài sản tạo từ đề xuất), phiếu thanh lý. Chỉ thêm cột / bảng mới.
ALTER TABLE assets ADD COLUMN request_id INTEGER;              -- đề xuất mua hàng / cấp phát đã duyệt
CREATE INDEX IF NOT EXISTS idx_assets_request ON assets(request_id);
CREATE INDEX IF NOT EXISTS idx_supply_moves_request ON asset_supply_moves(request_id);

CREATE TABLE IF NOT EXISTS asset_disposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  method TEXT NOT NULL,                        -- sell | destroy | donate | return_supplier
  proceeds INTEGER,                            -- số tiền thu về
  cost INTEGER,                                -- nguyên giá tại thời điểm thanh lý
  book_value INTEGER,                          -- giá trị còn lại tại ngày thanh lý
  request_id INTEGER,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_asset_disposals_date ON asset_disposals(date);
