-- LDL Checkin: ảnh chụp + vị trí (GPS) khi chấm công bằng điện thoại.
-- Bật theo từng văn phòng, riêng cho nhân viên văn phòng / đội sales (checkin_settings.photo_rules).
ALTER TABLE checkins ADD COLUMN in_photo TEXT;       -- khoá tệp ảnh trong storage
ALTER TABLE checkins ADD COLUMN in_lat REAL;
ALTER TABLE checkins ADD COLUMN in_lng REAL;
ALTER TABLE checkins ADD COLUMN in_accuracy REAL;    -- sai số GPS (mét)
ALTER TABLE checkins ADD COLUMN in_mobile INTEGER NOT NULL DEFAULT 0;
ALTER TABLE checkins ADD COLUMN out_photo TEXT;
ALTER TABLE checkins ADD COLUMN out_lat REAL;
ALTER TABLE checkins ADD COLUMN out_lng REAL;
ALTER TABLE checkins ADD COLUMN out_accuracy REAL;
ALTER TABLE checkins ADD COLUMN out_mobile INTEGER NOT NULL DEFAULT 0;
