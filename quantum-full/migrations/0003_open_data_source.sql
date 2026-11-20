-- Nguồn dữ liệu mở (bên thứ ba) dùng cho đồng bộ tự động.
-- vietlott.vn chặn truy cập tự động bằng lớp chống bot; hệ thống KHÔNG vượt cơ chế này.
INSERT INTO data_sources (name, kind, url, notes) VALUES (
  'vietlott-data (GitHub, MIT)',
  'third_party',
  'https://github.com/vietvudanh/vietlott-data',
  'Kho dữ liệu mở tổng hợp kết quả Vietlott, cập nhật hằng ngày, giấy phép MIT. Dữ liệu bên thứ ba — nhập ở trạng thái CHƯA XÁC MINH, cần đối chiếu nguồn chính thức trước khi xác minh.'
);

INSERT INTO app_settings (key, value_json, description) VALUES
  ('auto_sync_enabled', 'true', 'Tự động đồng bộ kết quả từ nguồn dữ liệu mở theo lịch (Cron)');
