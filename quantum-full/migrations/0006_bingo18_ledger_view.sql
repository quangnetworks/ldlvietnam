-- View sổ quỹ Bingo18 (thực tế).
CREATE VIEW bingo18_ledger_view AS
SELECT l.* FROM bankroll_ledger l JOIN games g ON g.id = l.game_id WHERE g.code = 'bingo18' AND l.mode = 'real';
