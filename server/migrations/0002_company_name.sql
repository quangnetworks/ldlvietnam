-- Đổi tên công ty mặc định (chỉ khi vẫn còn tên cũ, không ghi đè tên đã được quản trị viên đổi)
UPDATE settings SET value = 'Công ty LDL Việt Nam'
WHERE key = 'company_name' AND value IN ('CÔNG TY CỔ PHẦN LDL VIỆT NAM', 'Công ty');
