-- Seed CẤU HÌNH (không phải dữ liệu lịch sử). Không tạo kết quả quay giả.
-- Thể lệ được tổng hợp từ báo chí đăng lại thông tin của Vietlott; trạng thái 'unverified' cho tới khi
-- chủ dự án đối chiếu với thể lệ chính thức trên vietlott.vn và xác minh trong mục Cài đặt → Cấu hình game.

INSERT INTO games (code, name, main_min, main_max, main_picks, special_mode, special_min, special_max, ticket_price, prize_tiers_json, schedule_note, rules_verification_status, rules_source_url, rules_note)
VALUES (
  'lotto535', 'Lotto 5/35', 1, 35, 5, 'separate_pool', 1, 12, 10000,
  json('[
    {"code":"jackpot","name":"Độc đắc","mainMatches":5,"specialMatch":true,"kind":"jackpot","amount":6000000000,"shared":true},
    {"code":"first","name":"Giải Nhất","mainMatches":5,"specialMatch":false,"kind":"fixed","amount":10000000,"shared":false},
    {"code":"second","name":"Giải Nhì","mainMatches":4,"specialMatch":true,"kind":"fixed","amount":5000000,"shared":false},
    {"code":"third","name":"Giải Ba","mainMatches":4,"specialMatch":false,"kind":"fixed","amount":500000,"shared":false},
    {"code":"fourth","name":"Giải Tư","mainMatches":3,"specialMatch":true,"kind":"fixed","amount":100000,"shared":false},
    {"code":"fifth","name":"Giải Năm","mainMatches":3,"specialMatch":false,"kind":"fixed","amount":30000,"shared":false},
    {"code":"consolation_2","name":"Khuyến khích (2 số + ĐB)","mainMatches":2,"specialMatch":true,"kind":"fixed","amount":10000,"shared":false},
    {"code":"consolation_1","name":"Khuyến khích (1 số + ĐB)","mainMatches":1,"specialMatch":true,"kind":"fixed","amount":10000,"shared":false},
    {"code":"consolation_0","name":"Khuyến khích (0 số + ĐB)","mainMatches":0,"specialMatch":true,"kind":"fixed","amount":10000,"shared":false}
  ]'),
  'Quay 2 kỳ/ngày lúc 13:00 và 21:00, 7 ngày/tuần (theo báo chí — cần xác minh).',
  'unverified',
  'https://vietlott.vn',
  'Chọn 5 số 01–35 và 1 số đặc biệt 01–12. Độc đắc tối thiểu 6 tỷ, tích luỹ và CHIA GIẢI. Điều kiện từng hạng (đặc biệt hạng Khuyến khích) cần đối chiếu thể lệ chính thức.'
);

INSERT INTO games (code, name, main_min, main_max, main_picks, special_mode, special_min, special_max, ticket_price, prize_tiers_json, schedule_note, rules_verification_status, rules_source_url, rules_note)
VALUES (
  'power655', 'Power 6/55', 1, 55, 6, 'bonus_from_main', NULL, NULL, 10000,
  json('[
    {"code":"jackpot1","name":"Jackpot 1","mainMatches":6,"specialMatch":null,"kind":"jackpot","amount":30000000000,"shared":true},
    {"code":"jackpot2","name":"Jackpot 2","mainMatches":5,"specialMatch":true,"kind":"jackpot","amount":3000000000,"shared":true},
    {"code":"first","name":"Giải Nhất","mainMatches":5,"specialMatch":false,"kind":"fixed","amount":40000000,"shared":false},
    {"code":"second","name":"Giải Nhì","mainMatches":4,"specialMatch":null,"kind":"fixed","amount":500000,"shared":false},
    {"code":"third","name":"Giải Ba","mainMatches":3,"specialMatch":null,"kind":"fixed","amount":50000,"shared":false}
  ]'),
  'Quay thứ Ba, thứ Năm, thứ Bảy lúc 18:00 (cần xác minh).',
  'unverified',
  'https://vietlott.vn',
  'Chọn 6 số 01–55. Số đặc biệt được quay thêm từ 49 số còn lại, chỉ dùng xét Jackpot 2 (5 số + số đặc biệt). Jackpot 1 tối thiểu 30 tỷ, Jackpot 2 tối thiểu 3 tỷ, tích luỹ và chia giải.'
);

INSERT INTO data_sources (name, kind, url, notes) VALUES
  ('Vietlott (chính thức)', 'official', 'https://vietlott.vn', 'Nguồn ưu tiên. Hệ thống không tự thu thập (scrape); dữ liệu được nhập thủ công/CSV/JSON từ nguồn chính thức.'),
  ('Nhập tay', 'manual', NULL, 'Nhập thủ công có kiểm soát bởi quản trị viên.');

INSERT INTO model_versions (code, version, name, kind, is_baseline, description) VALUES
  ('random_uniform', '1.0.0', 'Ngẫu nhiên đồng đều', 'strategy', 1, 'Baseline khoa học — mọi tổ hợp đồng khả năng.'),
  ('balanced', '1.0.0', 'Cân bằng', 'strategy', 0, 'Ngẫu nhiên có ràng buộc cấu trúc; không thay đổi xác suất trúng.'),
  ('statistical', '1.0.0', 'Nghiên cứu thống kê', 'strategy', 0, 'Thực nghiệm: trọng số tần suất cửa sổ gần nhất.'),
  ('bayesian', '1.0.0', 'Thực nghiệm Bayes', 'strategy', 0, 'Thompson sampling từ posterior Dirichlet, prior đồng đều.'),
  ('portfolio_optimized', '1.0.0', 'Tối ưu danh mục', 'strategy', 0, 'Tối ưu độ phủ số/cặp và hạn chế trùng lặp.'),
  ('statistics', '1.0.0', 'Statistical Intelligence', 'analysis', 0, 'Tần suất, phân phối, χ² đã hiệu chỉnh, cặp/bộ ba với FDR.'),
  ('bayesian_analysis', '1.0.0', 'Bayesian Engine', 'analysis', 0, 'Beta-Binomial, Dirichlet-Multinomial, độ nhạy prior.'),
  ('markov', '1.0.0', 'Markov Analysis', 'analysis', 0, 'Kiểm định độc lập chuỗi, chuyển trạng thái, tự tương quan.'),
  ('monte_carlo', '1.0.0', 'Monte Carlo Engine', 'simulation', 0, 'Mô phỏng kỳ quay đồng đều có seed.'),
  ('ml_research', '1.0.0', 'Machine Learning Research', 'ml', 0, 'Logistic Regression, Random Forest, Gradient Boosting so với baseline.'),
  ('behavior', '1.0.0', 'Human Behavior Analysis', 'analysis', 0, 'Ước lượng mức phổ biến bộ số (heuristic).'),
  ('walk_forward_backtest', '1.0.0', 'Walk-forward Backtest', 'analysis', 0, 'Kiểm định walk-forward so với baseline.');

INSERT INTO app_settings (key, value_json, description) VALUES
  ('budget_per_draw', '100000', 'Ngân sách cố định mỗi kỳ (VND)'),
  ('monthly_budget', '1000000', 'Hạn mức chi tiêu thực tế mỗi tháng (VND)'),
  ('annual_budget', '12000000', 'Hạn mức chi tiêu thực tế mỗi năm (VND)'),
  ('statistics_include_unverified', 'false', 'Thống kê mặc định có dùng dữ liệu chưa xác minh hay không');
