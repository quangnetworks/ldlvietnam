-- Thỏa thuận cộng tác viên: khu vực phụ trách do công ty quy định (miền / khu vực / tỉnh trong Cơ cấu kinh doanh)
ALTER TABLE hr_contracts ADD COLUMN territory_id INTEGER REFERENCES territories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_hr_contracts_territory ON hr_contracts(territory_id);
