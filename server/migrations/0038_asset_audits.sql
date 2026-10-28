-- LDL Asset — kiểm kê định kỳ: mở đợt, quét QR / nhập mã để xác nhận có mặt, đối chiếu thiếu / sai người giữ, chốt biên bản.
-- Chỉ thêm bảng mới, không thay đổi dữ liệu hiện có.
CREATE TABLE IF NOT EXISTS asset_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  scope TEXT,                                   -- mô tả phạm vi (JSON bộ lọc lúc mở)
  status TEXT NOT NULL DEFAULT 'open',          -- open | closed
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS asset_audit_lines (
  audit_id INTEGER NOT NULL REFERENCES asset_audits(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  expected_holder_id INTEGER,                   -- người giữ theo sổ lúc mở đợt
  expected_place TEXT,                          -- vị trí / NPP theo sổ lúc mở đợt
  found INTEGER NOT NULL DEFAULT 0,
  found_at TEXT,
  found_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  condition TEXT,
  actual_place TEXT,                            -- ghi nhận nếu khác sổ
  note TEXT,
  PRIMARY KEY (audit_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_audit_lines_asset ON asset_audit_lines(asset_id);
