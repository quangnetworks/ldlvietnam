-- Công việc lặp lại: tự thêm kỳ (ngày / tuần / tháng) vào tên công việc, cập nhật theo từng kỳ.
ALTER TABLE tasks ADD COLUMN recurring_title INTEGER NOT NULL DEFAULT 0;
