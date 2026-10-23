-- LDL Asset — công cụ dụng cụ cấp phát theo SỐ LƯỢNG (đồng phục, nón, xe kéo…), theo dõi theo người giữ.
-- Người giữ có thể là nhân sự có tài khoản, nhân sự thị trường không có tài khoản (PG/PS/PB), hoặc đối tác (NPP).
-- Chỉ thêm bảng mới, không thay đổi dữ liệu hiện có.

CREATE TABLE IF NOT EXISTS asset_supply_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  unit TEXT NOT NULL DEFAULT 'cái',
  price INTEGER,                                -- đơn giá (tham khảo)
  penalty INTEGER,                              -- mức bồi thường / đơn vị khi không hoàn trả
  returnable INTEGER NOT NULL DEFAULT 1,        -- phải hoàn trả khi nghỉ việc
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS asset_supply_holders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- liên kết nhân sự trên hệ thống (nếu có)
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'person',          -- person | partner (NPP / đại lý)
  role TEXT,                                    -- PG / PS / PB / SS / TL…
  area TEXT,                                    -- tỉnh / khu vực
  partner TEXT,                                 -- NPP đang làm việc cùng
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_supply_holders_user ON asset_supply_holders(user_id);

-- Sổ nhập – xuất. Kho công ty = holder NULL.
--   opening  : số dư đầu kỳ của người giữ (to)        receive : nhập kho
--   issue    : kho → người giữ                          return  : người giữ → kho
--   transfer : người giữ → người giữ                    writeoff: hỏng / mất / tiêu hao (from), có thể kèm bồi thường
CREATE TABLE IF NOT EXISTS asset_supply_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES asset_supply_items(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  qty INTEGER NOT NULL,
  from_holder_id INTEGER REFERENCES asset_supply_holders(id) ON DELETE SET NULL,
  to_holder_id INTEGER REFERENCES asset_supply_holders(id) ON DELETE SET NULL,
  reason TEXT,                                  -- writeoff: damaged | lost | consumed
  charge INTEGER,                               -- số tiền bồi thường ghi nhận
  note TEXT,
  request_id INTEGER,                           -- đề xuất cấp phát (LDL Request) liên quan
  batch TEXT,                                   -- các dòng của cùng một lần ghi
  voided INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_supply_moves_from ON asset_supply_moves(from_holder_id, item_id);
CREATE INDEX IF NOT EXISTS idx_supply_moves_to ON asset_supply_moves(to_holder_id, item_id);
CREATE INDEX IF NOT EXISTS idx_supply_moves_batch ON asset_supply_moves(batch);
