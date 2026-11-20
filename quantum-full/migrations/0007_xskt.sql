-- Xổ số kiến thiết 3 miền (XSKT): kết quả quay theo đài, nguồn dữ liệu mở, trạng thái đồng bộ.
-- numbers_json: mảng chuỗi chữ số theo THỨ TỰ GIẢI của miền (xem src/engine/xskt.ts — LAYOUTS), giữ số 0 ở đầu.

INSERT INTO data_sources (name, kind, url, notes) VALUES
  ('vietnam-lottery-xsmb-analysis (GitHub, MIT)', 'third_party', 'https://github.com/khiemdoan/vietnam-lottery-xsmb-analysis',
   'Kết quả XSKT miền Bắc từ 2005, cập nhật hằng ngày bằng GitHub Actions, giấy phép MIT. Dữ liệu bên thứ ba — lưu ở trạng thái CHƯA XÁC MINH.'),
  ('xosomn-xosomt (GitHub, MIT)', 'third_party', 'https://github.com/tuanseo5t-alt/xosomn-xosomt',
   'Kết quả XSKT miền Nam (2008→) và miền Trung (2009→) theo đài, cập nhật hằng ngày, giấy phép MIT. Dữ liệu bên thứ ba — lưu ở trạng thái CHƯA XÁC MINH.');

CREATE TABLE xskt_draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region TEXT NOT NULL CHECK (region IN ('mb', 'mn', 'mt')),
  station TEXT NOT NULL CHECK (length(station) BETWEEN 1 AND 64),
  draw_date TEXT NOT NULL CHECK (draw_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  special TEXT NOT NULL CHECK (special GLOB '[0-9]*' AND length(special) BETWEEN 4 AND 6),
  numbers_json TEXT NOT NULL CHECK (json_valid(numbers_json)),
  data_source_id INTEGER NOT NULL REFERENCES data_sources(id),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'rejected')),
  source_hash TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (region, station, draw_date)
);
CREATE INDEX idx_xskt_region_date ON xskt_draws(region, draw_date);
CREATE INDEX idx_xskt_station_date ON xskt_draws(region, station, draw_date);

CREATE TRIGGER trg_xskt_verified_immutable
BEFORE UPDATE OF region, station, draw_date, special, numbers_json ON xskt_draws
WHEN OLD.verification_status = 'verified'
BEGIN
  SELECT RAISE(ABORT, 'verified_draw_immutable');
END;
CREATE TRIGGER trg_xskt_verified_no_delete
BEFORE DELETE ON xskt_draws
WHEN OLD.verification_status = 'verified'
BEGIN
  SELECT RAISE(ABORT, 'verified_draw_immutable');
END;

INSERT INTO model_versions (code, version, name, kind, is_baseline, description) VALUES
  ('xskt_analysis', '1.0.0', 'XSKT 3 miền — kiểm định, mô hình dự báo, giá trị vé', 'analysis', 0,
   'Kiểm định ngẫu nhiên theo miền/đài (BH), mô hình Nóng/Lạnh/Bayes/Markov/Tổ hợp chấm walk-forward bằng log-loss so với đồng đều, kỳ vọng chính xác từng giải.');

INSERT INTO app_settings (key, value_json, description) VALUES
  ('xskt_sync', '{}', 'Trạng thái đồng bộ XSKT 3 miền (ngày mới nhất đã nhập theo miền, lần chạy cuối)');

-- Bộ nhớ đệm kết quả phân tích XSKT (tính lại khi dữ liệu đổi: fingerprint = số kỳ + ngày mới nhất + tham số).
CREATE TABLE xskt_cache (
  cache_key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
