-- Kiêm nhiệm có thời hạn + mã phụ cho vị trí kiêm nhiệm (VD SS kiêm thêm SREP trong một giai đoạn: mã NV-1, mã NV-2)
ALTER TABLE territory_members ADD COLUMN until TEXT;           -- hết hạn kiêm nhiệm (yyyy-mm-dd); NULL = không thời hạn
ALTER TABLE territory_members ADD COLUMN sub_index INTEGER;    -- mã phụ của vị trí kiêm nhiệm SREP / SREP KA: 1 → "-1", 2 → "-2"
ALTER TABLE territory_history ADD COLUMN until TEXT;
ALTER TABLE territory_history ADD COLUMN sub_index INTEGER;
CREATE INDEX IF NOT EXISTS idx_territory_members_until ON territory_members(until);
