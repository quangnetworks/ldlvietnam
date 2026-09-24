-- Bảo mật (2FA, tài khoản khách), Webhook Request, HRM+ (Checkin, Timeoff, HRM), Drive, Message

ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN expires_at TEXT; -- tài khoản khách: hết hạn truy cập

-- ================= Webhook (Request) =================
CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]',
  group_id INTEGER REFERENCES request_groups(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id INTEGER REFERENCES webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  request_id INTEGER,
  status_code INTEGER,
  ok INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  duration_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_webhook_logs ON webhook_logs(webhook_id, id);

-- ================= HRM =================
CREATE TABLE IF NOT EXISTS hr_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  employee_code TEXT,
  gender TEXT,
  id_number TEXT,
  id_issue_date TEXT,
  id_issue_place TEXT,
  hire_date TEXT,
  probation_end TEXT,
  contract_type TEXT,
  contract_end TEXT,
  work_status TEXT NOT NULL DEFAULT 'working', -- working | probation | leave | resigned
  insurance_number TEXT,
  tax_code TEXT,
  bank_account TEXT,
  emergency_contact TEXT,
  note TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ================= Checkin (chấm công) =================
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,              -- ngày làm việc theo giờ Việt Nam (YYYY-MM-DD)
  check_in_at TEXT,                -- UTC 'YYYY-MM-DD HH:MM:SS'
  check_out_at TEXT,
  ip TEXT,
  note TEXT,
  UNIQUE (user_id, date)
);

-- ================= Timeoff (nghỉ phép) =================
CREATE TABLE IF NOT EXISTS leave_quotas (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  days REAL NOT NULL,
  PRIMARY KEY (user_id, year)
);

-- ================= Drive =================
CREATE TABLE IF NOT EXISTS drive_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES drive_items(id) ON DELETE CASCADE,
  space TEXT NOT NULL DEFAULT 'personal', -- personal | company
  kind TEXT NOT NULL DEFAULT 'file',      -- folder | file
  name TEXT NOT NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  filename TEXT,
  mime TEXT,
  size INTEGER,
  starred_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_drive_parent ON drive_items(parent_id);

CREATE TABLE IF NOT EXISTS drive_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES drive_items(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES user_groups(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'view' -- view | edit
);
CREATE INDEX IF NOT EXISTS idx_drive_shares_item ON drive_shares(item_id);

-- ================= Message (chat) =================
CREATE TABLE IF NOT EXISTS chat_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'public', -- public | private | direct
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_message_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_members (
  channel_id INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content TEXT,
  filename TEXT,
  original_name TEXT,
  mime TEXT,
  size INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  edited_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_messages ON chat_messages(channel_id, id);

-- Ứng dụng mới và quyền mặc định cho tài khoản nhân viên hiện có
INSERT OR IGNORE INTO apps(key, enabled) VALUES ('checkin', 1);
INSERT OR IGNORE INTO apps(key, enabled) VALUES ('timeoff', 1);
INSERT OR IGNORE INTO apps(key, enabled) VALUES ('hrm', 1);
INSERT OR IGNORE INTO apps(key, enabled) VALUES ('drive', 1);
INSERT OR IGNORE INTO apps(key, enabled) VALUES ('message', 1);
INSERT OR IGNORE INTO app_access(app_key, user_id) SELECT a.key, u.id FROM apps a CROSS JOIN users u
  WHERE a.key IN ('checkin', 'timeoff', 'hrm', 'drive', 'message') AND u.role <> 'guest';

-- Kênh chat chung của công ty
INSERT INTO chat_channels(name, description, kind)
SELECT 'chung', 'Kênh trao đổi chung toàn công ty', 'public'
WHERE NOT EXISTS (SELECT 1 FROM chat_channels WHERE kind = 'public' AND name = 'chung');
