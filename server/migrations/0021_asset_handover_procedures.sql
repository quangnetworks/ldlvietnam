-- ================= LDL Asset: tài sản, công cụ gắn với từng cá nhân; bàn giao / thu hồi; thủ tục nhận việc / nghỉ việc =================
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT,                                  -- loại tài sản (danh mục trong Cài đặt)
  kind TEXT NOT NULL DEFAULT 'asset',         -- asset = tài sản cố định | tool = công cụ dụng cụ
  serial TEXT,
  location TEXT,
  supplier TEXT,
  purchase_date TEXT,
  price INTEGER,
  depreciation_months INTEGER,                -- khấu hao đường thẳng (tháng)
  warranty_until TEXT,
  status TEXT NOT NULL DEFAULT 'available',   -- available | in_use | maintenance | broken | lost | disposed
  holder_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TEXT,
  condition TEXT NOT NULL DEFAULT 'good',     -- new | good | fair | poor | broken
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assets_holder ON assets(holder_id);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);

-- Biên bản bàn giao (issue) / thu hồi (return)
CREATE TABLE IF NOT EXISTS asset_handovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  kind TEXT NOT NULL,                         -- issue | return
  reason TEXT NOT NULL DEFAULT 'adhoc',       -- onboard | offboard | transfer | adhoc
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  procedure_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',     -- pending (chờ nhân viên xác nhận) | confirmed | cancelled
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  confirmed_at TEXT,
  confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  confirm_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_asset_handovers_employee ON asset_handovers(employee_id);

CREATE TABLE IF NOT EXISTS asset_handover_items (
  handover_id INTEGER NOT NULL REFERENCES asset_handovers(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  condition TEXT,
  note TEXT,
  PRIMARY KEY (handover_id, asset_id)
);

-- Lịch sử giao dịch của từng tài sản
CREATE TABLE IF NOT EXISTS asset_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                         -- create | assign | return | transfer | status | update
  from_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handover_id INTEGER,
  detail TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_asset_tx_asset ON asset_transactions(asset_id);

-- Thủ tục nhận việc (onboard) / nghỉ việc (offboard): checklist các bước, gắn biên bản bàn giao / thu hồi tài sản
CREATE TABLE IF NOT EXISTS hr_procedures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                         -- onboard | offboard
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effective_date TEXT NOT NULL,               -- ngày nhận việc / ngày nghỉ việc
  status TEXT NOT NULL DEFAULT 'open',        -- open | done | cancelled
  steps TEXT NOT NULL DEFAULT '[]',           -- JSON [{ key, label, done, done_at, done_by }]
  resign_reason TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hr_procedures_user ON hr_procedures(user_id);

INSERT OR IGNORE INTO apps(key, enabled) VALUES ('asset', 1);
INSERT OR IGNORE INTO app_access(app_key, user_id) SELECT 'asset', u.id FROM users u WHERE u.role <> 'guest';
