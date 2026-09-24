-- Nền tảng Account (nhóm người dùng, quyền ứng dụng, nhật ký đăng nhập, ghi chú)
-- và phân hệ Request (đề xuất / phê duyệt)

ALTER TABLE users ADD COLUMN birthday TEXT;
ALTER TABLE users ADD COLUMN address TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN profile TEXT; -- JSON: { education: [], experience: [], awards: [] }
ALTER TABLE users ADD COLUMN last_login_at TEXT;

CREATE TABLE IF NOT EXISTS user_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_group_members (
  group_id INTEGER NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

-- Ứng dụng của hệ sinh thái được bật cho công ty
CREATE TABLE IF NOT EXISTS apps (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1
);

-- Quyền sử dụng ứng dụng theo từng tài khoản
CREATE TABLE IF NOT EXISTS app_access (
  app_key TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (app_key, user_id)
);

CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  username TEXT,
  success INTEGER NOT NULL DEFAULT 1,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id, id);

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  color TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ================= REQUEST (Đề xuất) =================
CREATE TABLE IF NOT EXISTS request_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'Chung',
  fields TEXT NOT NULL DEFAULT '[]',          -- JSON: [{ key, label, type, required, options }]
  flow TEXT NOT NULL DEFAULT 'sequential',    -- 'any' = chỉ cần một người duyệt, 'sequential' = duyệt lần lượt
  custom_approvers INTEGER NOT NULL DEFAULT 1, -- người tạo được tự chọn / thêm người duyệt
  sla_hours INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS request_group_approvers (
  group_id INTEGER NOT NULL REFERENCES request_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS request_group_followers (
  group_id INTEGER NOT NULL REFERENCES request_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS request_group_stars (
  group_id INTEGER NOT NULL REFERENCES request_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER REFERENCES request_groups(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  flow TEXT NOT NULL DEFAULT 'sequential',
  creator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- draft | pending | approved | rejected | returned | cancelled
  deadline_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_requests_creator ON requests(creator_id);

CREATE TABLE IF NOT EXISTS request_approvers (
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | returned | skipped
  comment TEXT,
  acted_at TEXT,
  PRIMARY KEY (request_id, user_id)
);

CREATE TABLE IF NOT EXISTS request_followers (
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (request_id, user_id)
);

CREATE TABLE IF NOT EXISTS request_stars (
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (request_id, user_id)
);

CREATE TABLE IF NOT EXISTS request_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS request_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Ứng dụng mặc định và quyền truy cập cho tài khoản hiện có
INSERT OR IGNORE INTO apps(key, enabled) VALUES ('office', 1), ('wework', 1), ('request', 1);
INSERT OR IGNORE INTO app_access(app_key, user_id) SELECT a.key, u.id FROM apps a CROSS JOIN users u;

-- Nhóm đề xuất mẫu (chỉ tạo khi chưa có nhóm nào)
INSERT INTO request_groups(name, description, category, fields, flow, sla_hours)
SELECT * FROM (
  SELECT 'Đề xuất nghỉ phép', 'Xin nghỉ phép năm, nghỉ việc riêng', 'Hành chính - Nhân sự',
    '[{"key":"from","label":"Nghỉ từ ngày","type":"date","required":true},{"key":"to","label":"Đến ngày","type":"date","required":true},{"key":"kind","label":"Loại nghỉ","type":"select","options":["Nghỉ phép năm","Nghỉ không lương","Nghỉ ốm","Việc riêng có lương"],"required":true},{"key":"reason","label":"Lý do","type":"textarea","required":true}]',
    'sequential', 24
  UNION ALL SELECT 'Đề xuất đi công tác', 'Đăng ký lịch và chi phí công tác', 'Hành chính - Nhân sự',
    '[{"key":"place","label":"Nơi công tác","type":"text","required":true},{"key":"from","label":"Từ ngày","type":"date","required":true},{"key":"to","label":"Đến ngày","type":"date","required":true},{"key":"budget","label":"Dự trù chi phí (VNĐ)","type":"money"}]',
    'sequential', 24
  UNION ALL SELECT 'Đề nghị tạm ứng', 'Tạm ứng tiền phục vụ công việc', 'Tài chính - Kế toán',
    '[{"key":"amount","label":"Số tiền (VNĐ)","type":"money","required":true},{"key":"purpose","label":"Mục đích","type":"textarea","required":true},{"key":"refund_date","label":"Ngày hoàn ứng dự kiến","type":"date"}]',
    'sequential', 48
  UNION ALL SELECT 'Đề nghị thanh toán', 'Thanh toán chi phí đã phát sinh, kèm chứng từ', 'Tài chính - Kế toán',
    '[{"key":"amount","label":"Số tiền (VNĐ)","type":"money","required":true},{"key":"payee","label":"Người / đơn vị thụ hưởng","type":"text","required":true},{"key":"method","label":"Hình thức","type":"select","options":["Chuyển khoản","Tiền mặt"]},{"key":"note","label":"Diễn giải","type":"textarea"}]',
    'sequential', 48
  UNION ALL SELECT 'Đề xuất mua hàng', 'Mua sắm vật tư, thiết bị, văn phòng phẩm', 'Mua hàng',
    '[{"key":"items","label":"Danh sách hàng hoá","type":"textarea","required":true},{"key":"amount","label":"Tổng giá trị dự kiến (VNĐ)","type":"money","required":true},{"key":"supplier","label":"Nhà cung cấp đề xuất","type":"text"},{"key":"needed","label":"Ngày cần hàng","type":"date"}]',
    'any', 24
  UNION ALL SELECT 'Đề xuất cấp văn phòng phẩm', 'Cấp phát văn phòng phẩm hằng tháng', 'Hành chính - Nhân sự',
    '[{"key":"items","label":"Vật phẩm cần cấp","type":"textarea","required":true}]',
    'any', NULL
) WHERE NOT EXISTS (SELECT 1 FROM request_groups);
