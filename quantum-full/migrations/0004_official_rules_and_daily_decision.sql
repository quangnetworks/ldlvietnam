-- Đối chiếu thể lệ với nguồn chính thức vietlott.vn (2026-11-20) + lịch quay + quyết định hằng ngày.

ALTER TABLE games ADD COLUMN draw_schedule_json TEXT CHECK (draw_schedule_json IS NULL OR json_valid(draw_schedule_json));

UPDATE games SET
  draw_schedule_json = '{"times":["13:00","21:00"],"cutoffMinutes":15}',
  schedule_note = 'Quay 2 kỳ mỗi ngày lúc 13:00 và 21:00, 7 ngày/tuần (vietlott.vn).',
  rules_verification_status = 'verified',
  rules_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  rules_source_url = 'https://vietlott.vn/vi/choi/lotto535/gioi-thieu-san-pham-535',
  rules_note = 'Đối chiếu vietlott.vn: 7 hạng giải, vé 10.000đ; Độc đắc ≥ 6 tỷ, tích luỹ, chia theo tỷ lệ giá trị tham gia nếu nhiều người trúng; Nhất 10tr (5 số); Nhì 5tr (4 số + ĐB); Ba 500k (4 số); Tư 100k (3 số + ĐB); Năm 30k (3 số); Khuyến khích 10k (0/1/2 số + ĐB — ký hiệu 3 dạng trên bảng kết quả chính thức). Một vé chỉ nhận hạng cao nhất. Khi Độc đắc vượt 12 tỷ mà chưa có người trúng, kỳ cuối của ngày kế tiếp là kỳ “Chia giải Độc đắc”.',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE code = 'lotto535';

UPDATE games SET
  draw_schedule_json = '{"weekdays":[2,4,6],"times":["18:00"],"cutoffMinutes":15}',
  schedule_note = 'Quay thứ Ba, thứ Năm, thứ Bảy lúc 18:00.',
  rules_verification_status = 'verified',
  rules_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  rules_source_url = 'https://vietlott.vn/vi/choi/power-6-55/co-cau-giai-thuong',
  rules_note = 'Đối chiếu vietlott.vn: Jackpot 1 (6 số) ≥ 30 tỷ tích luỹ; Jackpot 2 (5 số + số đặc biệt quay từ các số còn lại) ≥ 3 tỷ tích luỹ; Nhất 40tr (5 số); Nhì 500k (4 số); Ba 50k (3 số). Nhiều người trúng Jackpot chia theo giá trị tham gia. Một vé chỉ nhận hạng cao nhất. Thể lệ: https://vietlott.vn/vi/choi/power-6-55/gioi-thieu-san-pham-power-655',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE code = 'power655';

INSERT INTO app_settings (key, value_json, description) VALUES
  ('current_jackpots', '{}', 'Giá trị Jackpot hiện tại theo game/hạng do quản trị viên cập nhật từ vietlott.vn'),
  ('decision_mode', '"discipline"', 'Chế độ quyết định mua hằng ngày: discipline | value | minimal'),
  ('decision_value_threshold', '0.5', 'Ngưỡng tỷ lệ hoàn vốn kỳ vọng (sau thuế) cho chế độ value'),
  ('decision_apply_tax', 'true', 'Tính thuế TNCN 10% trên phần thưởng vượt 10 triệu đồng khi đánh giá kỳ vọng');

INSERT INTO model_versions (code, version, name, kind, is_baseline, description) VALUES
  ('daily_decision', '1.0.0', 'Quyết định mua hằng ngày', 'analysis', 0, 'Chọn kỳ quay & số vé theo kỳ vọng sau thuế, Jackpot hiện tại và kỷ luật vốn. Không dự đoán số.');

INSERT INTO audit_logs (actor, actor_role, action, entity_type, entity_id, after_json) VALUES
  ('system:migration-0004', 'system', 'games.verify_rules', 'game', 'lotto535,power655',
   json('{"sources":["https://vietlott.vn/vi/choi/lotto535/gioi-thieu-san-pham-535","https://vietlott.vn/vi/trung-thuong/ket-qua-trung-thuong/535.html","https://vietlott.vn/vi/choi/power-6-55/co-cau-giai-thuong","https://vietlott.vn/vi/choi/power-6-55/gioi-thieu-san-pham-power-655"],"note":"Giá trị & điều kiện các hạng khớp cấu hình đã seed; thêm lịch quay."}'));
