-- ================= LDL Request: quy trình duyệt, phạm vi sử dụng (theo Base Request) =================
-- flow của nhóm: 'sequential' (duyệt lần lượt) | 'parallel' (duyệt đồng thời — tất cả cùng nhận, tất cả phải đồng ý)
--               | 'any' (chỉ cần một người duyệt) | 'blocks' (luồng duyệt trong khối người duyệt)
-- Khối người duyệt: request_group_approvers.step = số thứ tự khối; chế độ từng khối lưu ở block_modes (JSON: {"1":"all","2":"any"})
ALTER TABLE request_groups ADD COLUMN block_modes TEXT;
-- Phạm vi: 'public' = mọi người tạo được; 'private' = chỉ phòng ban / người được chọn ở request_group_members
ALTER TABLE request_groups ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
-- Gửi đề xuất tới quản lý trực tiếp của người tạo (thêm vào người theo dõi)
ALTER TABLE request_groups ADD COLUMN notify_manager INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS request_group_members (
  group_id INTEGER NOT NULL REFERENCES request_groups(id) ON DELETE CASCADE,
  department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_request_group_members ON request_group_members(group_id);

-- Chế độ của chặng đề xuất: 'all' = mọi người trong chặng phải đồng ý, 'any' = một người đồng ý là qua chặng
ALTER TABLE request_approvers ADD COLUMN step_mode TEXT NOT NULL DEFAULT 'all';

-- ================= LDL HRM: hồ sơ mở rộng, hợp đồng, phát triển sự nghiệp, giấy tờ (theo Base HRM) =================
ALTER TABLE hr_profiles ADD COLUMN official_date TEXT;      -- ngày chính thức
ALTER TABLE hr_profiles ADD COLUMN office TEXT;             -- văn phòng / chi nhánh
ALTER TABLE hr_profiles ADD COLUMN job_position TEXT;       -- vị trí công việc
ALTER TABLE hr_profiles ADD COLUMN employee_type TEXT;      -- phân loại nhân sự (Full-time, Part-time…)
ALTER TABLE hr_profiles ADD COLUMN resign_date TEXT;        -- ngày nghỉ việc
ALTER TABLE hr_profiles ADD COLUMN resign_reason TEXT;      -- lý do nghỉ việc

CREATE TABLE IF NOT EXISTS hr_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT,
  contract_type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  salary INTEGER,
  status TEXT NOT NULL DEFAULT 'active',   -- active | ended | terminated
  note TEXT,
  filename TEXT,
  original_name TEXT,
  mime TEXT,
  size INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_contracts_user ON hr_contracts(user_id);

-- Phát triển sự nghiệp: thăng tiến, điều chỉnh lương, điều chuyển, khen thưởng, kỷ luật
CREATE TABLE IF NOT EXISTS hr_careers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                      -- promotion | raise | transfer | reward | discipline
  effective_date TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  decision_no TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_careers_user ON hr_careers(user_id);

-- Hồ sơ giấy tờ nhân viên (CCCD, bằng cấp, sơ yếu lý lịch, giấy khám sức khoẻ…)
CREATE TABLE IF NOT EXISTS hr_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  note TEXT,
  expires_on TEXT,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hr_documents_user ON hr_documents(user_id);
