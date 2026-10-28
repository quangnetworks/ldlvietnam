-- HRM: cộng tác viên hưởng % theo thỏa thuận (thay cho hợp đồng lao động)
-- Hình thức hợp tác trên hồ sơ: NULL / 'employee' = nhân viên (hợp đồng lao động), 'collaborator' = cộng tác viên
ALTER TABLE hr_profiles ADD COLUMN engagement TEXT;

-- hr_contracts dùng chung cho hợp đồng lao động (kind 'labor') và thỏa thuận hợp tác của cộng tác viên (kind 'collab')
ALTER TABLE hr_contracts ADD COLUMN kind TEXT NOT NULL DEFAULT 'labor';
ALTER TABLE hr_contracts ADD COLUMN commission_rate REAL;      -- tỷ lệ hưởng (%)
ALTER TABLE hr_contracts ADD COLUMN commission_basis TEXT;     -- cơ sở tính: doanh số, doanh thu thuần, lợi nhuận gộp…
ALTER TABLE hr_contracts ADD COLUMN payment_cycle TEXT;        -- kỳ thanh toán: monthly | quarterly | per_deal
ALTER TABLE hr_contracts ADD COLUMN scope TEXT;                -- phạm vi / nội dung hợp tác

CREATE INDEX IF NOT EXISTS idx_hr_contracts_kind ON hr_contracts(kind, status);
CREATE INDEX IF NOT EXISTS idx_hr_profiles_engagement ON hr_profiles(engagement);
