-- Cho phép ĐIỀN giờ quay còn trống của kỳ đã xác minh (đồng bộ lúc chỉ có kỳ 13:00 trong ngày nên chưa suy ra được giờ).
-- Vẫn chặn mọi thay đổi khác của kỳ đã xác minh: mã kỳ, ngày, game, số đặc biệt, hay đổi một giờ đã có.
DROP TRIGGER IF EXISTS trg_draws_verified_immutable;
CREATE TRIGGER trg_draws_verified_immutable
BEFORE UPDATE OF draw_code, draw_date, draw_time, draw_at, special_number, game_id ON draws
WHEN OLD.verification_status = 'verified'
  AND NOT (
    OLD.draw_time IS NULL AND NEW.draw_time IS NOT NULL
    AND NEW.draw_code = OLD.draw_code AND NEW.draw_date = OLD.draw_date AND NEW.game_id = OLD.game_id
    AND NEW.special_number IS OLD.special_number
  )
BEGIN
  SELECT RAISE(ABORT, 'verified_draw_immutable');
END;
