-- QUANTUM FULL — schema khởi tạo
-- Nguyên tắc: khoá ngoại, ràng buộc duy nhất, chỉ mục, mốc thời gian, nguồn gốc dữ liệu, bất biến cho dữ liệu kiểm toán.

-- 1. games — cấu hình trò chơi (không hardcode trong mã)
CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE CHECK (length(code) BETWEEN 2 AND 32),
  name TEXT NOT NULL,
  main_min INTEGER NOT NULL CHECK (main_min >= 0),
  main_max INTEGER NOT NULL CHECK (main_max > main_min),
  main_picks INTEGER NOT NULL CHECK (main_picks >= 1),
  special_mode TEXT NOT NULL CHECK (special_mode IN ('none', 'separate_pool', 'bonus_from_main')),
  special_min INTEGER,
  special_max INTEGER,
  ticket_price INTEGER NOT NULL CHECK (ticket_price > 0),
  prize_tiers_json TEXT NOT NULL CHECK (json_valid(prize_tiers_json)),
  schedule_note TEXT,
  rules_verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (rules_verification_status IN ('unverified', 'verified')),
  rules_source_url TEXT,
  rules_verified_at TEXT,
  rules_note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (main_max - main_min + 1 >= main_picks),
  CHECK (special_mode <> 'separate_pool' OR (special_min IS NOT NULL AND special_max IS NOT NULL AND special_max >= special_min))
);

-- 2. data_sources — nguồn dữ liệu
CREATE TABLE data_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('official', 'third_party', 'manual')),
  url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 18. import_jobs — mỗi lần nhập dữ liệu
CREATE TABLE import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  data_source_id INTEGER NOT NULL REFERENCES data_sources(id),
  format TEXT NOT NULL CHECK (format IN ('csv', 'json', 'manual', 'api')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'partial', 'failed')),
  source_url TEXT,
  retrieved_at TEXT,
  payload_hash TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  conflicts INTEGER NOT NULL DEFAULT 0,
  invalid INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(errors_json)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_import_jobs_game ON import_jobs(game_id, created_at);

-- 3. draws — kết quả quay
CREATE TABLE draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  draw_code TEXT NOT NULL CHECK (length(draw_code) BETWEEN 1 AND 32),
  draw_date TEXT NOT NULL CHECK (draw_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  draw_time TEXT CHECK (draw_time IS NULL OR draw_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  draw_at TEXT NOT NULL,
  special_number INTEGER,
  data_source_id INTEGER NOT NULL REFERENCES data_sources(id),
  import_job_id INTEGER REFERENCES import_jobs(id),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'rejected')),
  source_hash TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  verified_at TEXT,
  verified_by TEXT,
  verification_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (game_id, draw_code)
);
CREATE INDEX idx_draws_game_time ON draws(game_id, draw_at);
CREATE INDEX idx_draws_status ON draws(game_id, verification_status);

-- Không được sửa nội dung kết quả ĐÃ XÁC MINH. Quy trình điều chỉnh phải mở lại (unverified) kèm audit log trước.
CREATE TRIGGER trg_draws_verified_immutable
BEFORE UPDATE OF draw_code, draw_date, draw_time, draw_at, special_number, game_id ON draws
WHEN OLD.verification_status = 'verified'
BEGIN
  SELECT RAISE(ABORT, 'verified_draw_immutable');
END;

CREATE TRIGGER trg_draws_verified_no_delete
BEFORE DELETE ON draws
WHEN OLD.verification_status = 'verified'
BEGIN
  SELECT RAISE(ABORT, 'verified_draw_immutable');
END;

-- 4. draw_numbers — các số chính của kỳ quay
CREATE TABLE draw_numbers (
  draw_id INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  number INTEGER NOT NULL CHECK (number >= 0),
  PRIMARY KEY (draw_id, position),
  UNIQUE (draw_id, number)
);
CREATE INDEX idx_draw_numbers_number ON draw_numbers(number);

CREATE TRIGGER trg_draw_numbers_verified_insert
BEFORE INSERT ON draw_numbers
WHEN (SELECT verification_status FROM draws WHERE id = NEW.draw_id) = 'verified'
BEGIN
  SELECT RAISE(ABORT, 'verified_draw_immutable');
END;
CREATE TRIGGER trg_draw_numbers_verified_update
BEFORE UPDATE ON draw_numbers
WHEN (SELECT verification_status FROM draws WHERE id = OLD.draw_id) = 'verified'
BEGIN
  SELECT RAISE(ABORT, 'verified_draw_immutable');
END;
CREATE TRIGGER trg_draw_numbers_verified_delete
BEFORE DELETE ON draw_numbers
WHEN (SELECT verification_status FROM draws WHERE id = OLD.draw_id) = 'verified'
BEGIN
  SELECT RAISE(ABORT, 'verified_draw_immutable');
END;

-- 5. model_versions — phiên bản thuật toán
CREATE TABLE model_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('strategy', 'analysis', 'ml', 'simulation')),
  is_baseline INTEGER NOT NULL DEFAULT 0 CHECK (is_baseline IN (0, 1)),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (code, version)
);

-- 6. model_runs — mỗi lần chạy mô hình (bất biến)
CREATE TABLE model_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_version_id INTEGER NOT NULL REFERENCES model_versions(id),
  game_id INTEGER NOT NULL REFERENCES games(id),
  run_type TEXT NOT NULL CHECK (run_type IN ('analysis', 'generate', 'portfolio', 'backtest', 'montecarlo', 'ml')),
  params_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(params_json)),
  seed TEXT,
  data_cutoff_at TEXT,
  data_draw_count INTEGER NOT NULL DEFAULT 0,
  dataset_hash TEXT,
  output_summary_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(output_summary_json)),
  duration_ms INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_model_runs_game ON model_runs(game_id, created_at);
CREATE TRIGGER trg_model_runs_no_update BEFORE UPDATE ON model_runs BEGIN SELECT RAISE(ABORT, 'model_runs_immutable'); END;
CREATE TRIGGER trg_model_runs_no_delete BEFORE DELETE ON model_runs BEGIN SELECT RAISE(ABORT, 'model_runs_immutable'); END;

-- 7. recommendations — bộ số đã sinh (bất biến: không sửa dự báo sau khi có kết quả)
CREATE TABLE recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_run_id INTEGER NOT NULL REFERENCES model_runs(id),
  game_id INTEGER NOT NULL REFERENCES games(id),
  strategy_code TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  target_draw_date TEXT,
  seed TEXT NOT NULL,
  data_cutoff_at TEXT,
  data_draw_count INTEGER NOT NULL DEFAULT 0,
  ticket_count INTEGER NOT NULL CHECK (ticket_count >= 1),
  ticket_price INTEGER NOT NULL CHECK (ticket_price > 0),
  total_cost INTEGER NOT NULL CHECK (total_cost = ticket_count * ticket_price),
  budget INTEGER NOT NULL CHECK (budget >= total_cost),
  params_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(params_json)),
  metrics_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json)),
  validation_status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_recommendations_game ON recommendations(game_id, created_at);
CREATE TRIGGER trg_recommendations_no_update BEFORE UPDATE ON recommendations BEGIN SELECT RAISE(ABORT, 'recommendations_immutable'); END;
CREATE TRIGGER trg_recommendations_no_delete BEFORE DELETE ON recommendations BEGIN SELECT RAISE(ABORT, 'recommendations_immutable'); END;

-- 8. recommendation_numbers
CREATE TABLE recommendation_numbers (
  recommendation_id INTEGER NOT NULL REFERENCES recommendations(id),
  ticket_index INTEGER NOT NULL CHECK (ticket_index >= 0),
  position INTEGER NOT NULL CHECK (position >= 0),
  number INTEGER NOT NULL,
  is_special INTEGER NOT NULL DEFAULT 0 CHECK (is_special IN (0, 1)),
  PRIMARY KEY (recommendation_id, ticket_index, position)
);
CREATE TRIGGER trg_recommendation_numbers_no_update BEFORE UPDATE ON recommendation_numbers BEGIN SELECT RAISE(ABORT, 'recommendations_immutable'); END;
CREATE TRIGGER trg_recommendation_numbers_no_delete BEFORE DELETE ON recommendation_numbers BEGIN SELECT RAISE(ABORT, 'recommendations_immutable'); END;
CREATE TRIGGER trg_recommendation_numbers_frozen BEFORE INSERT ON recommendation_numbers
WHEN (SELECT julianday('now') - julianday(created_at) FROM recommendations WHERE id = NEW.recommendation_id) > 0.01
BEGIN
  SELECT RAISE(ABORT, 'recommendations_immutable');
END;

-- 9. portfolios — danh mục vé (mô phỏng hoặc đã mua thực tế)
CREATE TABLE portfolios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  recommendation_id INTEGER REFERENCES recommendations(id),
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'simulated' CHECK (mode IN ('simulated', 'real')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'purchased', 'evaluated', 'cancelled')),
  target_draw_date TEXT,
  target_draw_time TEXT CHECK (target_draw_time IS NULL OR target_draw_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  target_draw_id INTEGER REFERENCES draws(id),
  ticket_count INTEGER NOT NULL CHECK (ticket_count >= 1),
  total_cost INTEGER NOT NULL CHECK (total_cost >= 0),
  notes TEXT,
  purchased_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_portfolios_game ON portfolios(game_id, target_draw_date);

-- 10. tickets
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  ticket_index INTEGER NOT NULL CHECK (ticket_index >= 0),
  special_number INTEGER,
  cost INTEGER NOT NULL CHECK (cost > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (portfolio_id, ticket_index)
);

-- 11. ticket_numbers
CREATE TABLE ticket_numbers (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  number INTEGER NOT NULL,
  PRIMARY KEY (ticket_id, position),
  UNIQUE (ticket_id, number)
);

-- 14. ticket_results — kết quả chấm vé
CREATE TABLE ticket_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  draw_id INTEGER NOT NULL REFERENCES draws(id),
  main_matches INTEGER NOT NULL CHECK (main_matches >= 0),
  special_matched INTEGER NOT NULL CHECK (special_matched IN (0, 1)),
  prize_tier_code TEXT,
  prize_amount INTEGER,
  evaluated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (ticket_id, draw_id)
);
CREATE INDEX idx_ticket_results_draw ON ticket_results(draw_id);

-- 12. backtest_runs
CREATE TABLE backtest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  model_run_id INTEGER REFERENCES model_runs(id),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  strategies_json TEXT NOT NULL CHECK (json_valid(strategies_json)),
  tickets_per_draw INTEGER NOT NULL CHECK (tickets_per_draw >= 1),
  min_history INTEGER NOT NULL CHECK (min_history >= 1),
  seed TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(params_json)),
  include_unverified INTEGER NOT NULL DEFAULT 0 CHECK (include_unverified IN (0, 1)),
  data_cutoff_at TEXT,
  dataset_hash TEXT NOT NULL,
  total_draws INTEGER NOT NULL,
  start_index INTEGER NOT NULL,
  next_index INTEGER NOT NULL,
  end_index INTEGER NOT NULL,
  error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);
CREATE INDEX idx_backtest_runs_game ON backtest_runs(game_id, created_at);

-- 13. backtest_metrics — kết quả từng bước & tổng hợp
CREATE TABLE backtest_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backtest_run_id INTEGER NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
  strategy_code TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('step', 'summary')),
  draw_id INTEGER REFERENCES draws(id),
  metrics_json TEXT NOT NULL CHECK (json_valid(metrics_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX uq_backtest_metrics_step ON backtest_metrics(backtest_run_id, strategy_code, draw_id) WHERE scope = 'step';
CREATE UNIQUE INDEX uq_backtest_metrics_summary ON backtest_metrics(backtest_run_id, strategy_code) WHERE scope = 'summary';

-- 15. bankroll_ledger — sổ quỹ (bất biến; điều chỉnh bằng bút toán mới)
CREATE TABLE bankroll_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('purchase', 'prize', 'adjustment')),
  mode TEXT NOT NULL CHECK (mode IN ('real', 'simulated')),
  amount INTEGER NOT NULL,
  game_id INTEGER REFERENCES games(id),
  portfolio_id INTEGER REFERENCES portfolios(id),
  draw_id INTEGER REFERENCES draws(id),
  entry_date TEXT NOT NULL CHECK (entry_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((entry_type = 'purchase' AND amount < 0) OR (entry_type = 'prize' AND amount >= 0) OR entry_type = 'adjustment')
);
CREATE INDEX idx_ledger_date ON bankroll_ledger(mode, entry_date);
CREATE UNIQUE INDEX uq_ledger_purchase ON bankroll_ledger(portfolio_id) WHERE entry_type = 'purchase';
CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE ON bankroll_ledger BEGIN SELECT RAISE(ABORT, 'ledger_immutable'); END;
CREATE TRIGGER trg_ledger_no_delete BEFORE DELETE ON bankroll_ledger BEGIN SELECT RAISE(ABORT, 'ledger_immutable'); END;

-- 16. audit_logs — nhật ký kiểm toán (bất biến)
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  request_id TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_immutable'); END;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_immutable'); END;

-- 17. app_settings
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  description TEXT,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
