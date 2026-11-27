-- Bingo18: phiên chơi trực tiếp, chốt phương án từng kỳ 6 phút theo lãi/lỗ thực tế và quy tắc dừng.
CREATE TABLE bingo18_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  bet_json TEXT NOT NULL CHECK (json_valid(bet_json)),
  base_units INTEGER NOT NULL CHECK (base_units BETWEEN 1 AND 100),
  budget INTEGER NOT NULL CHECK (budget > 0),
  take_profit INTEGER CHECK (take_profit IS NULL OR take_profit > 0),
  max_minutes INTEGER NOT NULL CHECK (max_minutes BETWEEN 5 AND 960),
  session_date TEXT NOT NULL CHECK (session_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at TEXT,
  end_reason TEXT,
  created_by TEXT NOT NULL
);
CREATE INDEX idx_bingo18_sessions_status ON bingo18_sessions(status, started_at);

CREATE TABLE bingo18_session_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES bingo18_sessions(id),
  draw_at TEXT NOT NULL CHECK (draw_at GLOB '[0-2][0-9]:[0-5][0-9]'),
  stake INTEGER NOT NULL CHECK (stake >= 0),
  prize INTEGER NOT NULL CHECK (prize >= 0),
  d1 INTEGER CHECK (d1 IS NULL OR d1 BETWEEN 1 AND 6),
  d2 INTEGER CHECK (d2 IS NULL OR d2 BETWEEN 1 AND 6),
  d3 INTEGER CHECK (d3 IS NULL OR d3 BETWEEN 1 AND 6),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (session_id, draw_at)
);

-- Lịch sử phiên là sổ ghi: không sửa, không xoá.
CREATE TRIGGER trg_bingo18_rounds_no_update BEFORE UPDATE ON bingo18_session_rounds BEGIN SELECT RAISE(ABORT, 'bingo18_round_immutable'); END;
CREATE TRIGGER trg_bingo18_rounds_no_delete BEFORE DELETE ON bingo18_session_rounds BEGIN SELECT RAISE(ABORT, 'bingo18_round_immutable'); END;
