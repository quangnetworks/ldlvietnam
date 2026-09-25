-- Mục tiêu: tự tính tiến độ theo tỷ lệ công việc đã hoàn thành (khi mục tiêu có công việc gắn kèm)
ALTER TABLE goals ADD COLUMN auto_progress INTEGER NOT NULL DEFAULT 1;
ALTER TABLE goals ADD COLUMN description TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
-- Mức ưu tiên mới 'critical' = Quan trọng & khẩn cấp (ma trận Eisenhower) — cột priority là TEXT nên không cần đổi cấu trúc
