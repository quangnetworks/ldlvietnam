-- Bingo18: trò chơi trả thưởng cố định, 3 số kết quả 1–6 (có thể trùng). Engine riêng 'dice3'.
ALTER TABLE games ADD COLUMN engine TEXT NOT NULL DEFAULT 'pick' CHECK (engine IN ('pick', 'dice3'));

INSERT INTO games (code, name, main_min, main_max, main_picks, special_mode, special_min, special_max, ticket_price, prize_tiers_json, schedule_note, rules_verification_status, rules_verified_at, rules_source_url, rules_note, engine, draw_schedule_json)
VALUES (
  'bingo18', 'Bingo18', 1, 6, 3, 'none', NULL, NULL, 10000, '[]',
  'Quay mỗi 6 phút từ 06:00 đến 21:53 hằng ngày; chỉ phát hành qua kênh điện thoại (Vietlott SMS).',
  'verified', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  'https://vietlott.vn/vi/choi/bingo/gioi-thieu-san-pham-bingo18',
  'Đối chiếu vietlott.vn: 3 số kết quả 1–6. Chọn 1 số: 12k/20k/30k khi xuất hiện 1/2/3 lần; Hai số trùng: 75k; Ba số trùng đúng số: 1,2tr; Ba số trùng bất kỳ: 200k; Tổng 3/18: 1,2tr, 4/17: 400k, 5/16: 200k, 6/15: 120k, 7/14: 80k, 8/13: 55k, 9/12: 47k, 10/11: 44k; Lớn (12–18) / Nhỏ (3–9): 15k; Hoà (10–11): 20k. Giá trị cho mỗi lần tham gia 10.000đ; mỗi cách chơi chỉ nhận một hạng.',
  'dice3',
  '{"times":[],"intervalMinutes":6,"start":"06:00","end":"21:53"}'
);

CREATE TABLE bingo18_draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draw_code TEXT NOT NULL UNIQUE,
  draw_date TEXT NOT NULL CHECK (draw_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  d1 INTEGER NOT NULL CHECK (d1 BETWEEN 1 AND 6),
  d2 INTEGER NOT NULL CHECK (d2 BETWEEN 1 AND 6),
  d3 INTEGER NOT NULL CHECK (d3 BETWEEN 1 AND 6),
  total INTEGER NOT NULL CHECK (total = d1 + d2 + d3),
  data_source_id INTEGER NOT NULL REFERENCES data_sources(id),
  import_job_id INTEGER REFERENCES import_jobs(id),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'rejected')),
  source_hash TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  verified_at TEXT,
  verified_by TEXT
);
CREATE INDEX idx_bingo18_date ON bingo18_draws(draw_date, draw_code);
CREATE INDEX idx_bingo18_job ON bingo18_draws(import_job_id);

CREATE TRIGGER trg_bingo18_verified_immutable
BEFORE UPDATE OF draw_code, draw_date, d1, d2, d3, total ON bingo18_draws
WHEN OLD.verification_status = 'verified'
BEGIN
  SELECT RAISE(ABORT, 'verified_draw_immutable');
END;
CREATE TRIGGER trg_bingo18_verified_no_delete
BEFORE DELETE ON bingo18_draws
WHEN OLD.verification_status = 'verified'
BEGIN
  SELECT RAISE(ABORT, 'verified_draw_immutable');
END;

INSERT INTO model_versions (code, version, name, kind, is_baseline, description) VALUES
  ('bingo18_analysis', '1.0.0', 'Bingo18 — xác suất & kiểm định', 'analysis', 0, 'Xác suất chính xác 216 kết quả, EV từng cược, kiểm định ngẫu nhiên, mô phỏng phiên chơi.');

INSERT INTO app_settings (key, value_json, description) VALUES
  ('bingo18_sync', '{"backfillEndByte":null,"done":false}', 'Con trỏ tải dần lịch sử Bingo18 từ nguồn mở'),
  ('bingo18_daily_limit', '50000', 'Hạn mức chi cho Bingo18 mỗi ngày (VND)'),
  ('bingo18_session_minutes', '30', 'Giới hạn thời gian một phiên chơi Bingo18 (phút)');
