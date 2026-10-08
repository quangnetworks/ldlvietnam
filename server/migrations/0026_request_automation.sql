-- ================= Tự động hoá khi đề xuất được duyệt =================
-- Cấu hình trên nhóm đề xuất (JSON): { type: 'hire', map: { name: '<key trường>', email, phone, … }, password_hash, onboarding }
--   hire = khi duyệt xong: tạo tài khoản LDL + hồ sơ HRM (thử việc) + mở thủ tục nhận việc, báo phòng Nhân sự
ALTER TABLE request_groups ADD COLUMN automation TEXT;
-- Kết quả chạy tự động của từng đề xuất (JSON): { type, status: done | error, user_id, username, error, at }
ALTER TABLE requests ADD COLUMN automation_result TEXT;

-- Nhóm mẫu "Đề xuất tuyển dụng" — trường đã được nối sẵn với hồ sơ nhân sự
INSERT INTO request_groups(name, description, category, fields, flow, sla_hours, manager_approval, visibility, automation)
SELECT 'Đề xuất tuyển dụng', 'Đề xuất tiếp nhận nhân sự mới. Khi được duyệt, hệ thống tự tạo tài khoản LDL, hồ sơ HRM (thử việc) và thủ tục nhận việc để phòng Nhân sự cập nhật tiếp.', 'Hành chính - Nhân sự',
  '[{"key":"name","label":"Họ tên ứng viên","type":"text","required":true},{"key":"email","label":"Email","type":"text","required":false},{"key":"phone","label":"Điện thoại","type":"text","required":false},{"key":"birthday","label":"Ngày sinh","type":"date","required":false},{"key":"gender","label":"Giới tính","type":"select","required":false,"options":["Nam","Nữ","Khác"]},{"key":"title","label":"Chức danh","type":"text","required":true},{"key":"department","label":"Phòng ban","type":"text","required":true},{"key":"manager","label":"Quản lý trực tiếp","type":"user","required":false},{"key":"job_position","label":"Vị trí công việc","type":"text","required":false},{"key":"office","label":"Văn phòng","type":"text","required":false},{"key":"employee_type","label":"Phân loại nhân sự","type":"select","required":false,"options":["Toàn thời gian","Bán thời gian","Cộng tác viên","Thực tập"]},{"key":"hire_date","label":"Ngày nhận việc","type":"date","required":true},{"key":"probation_end","label":"Ngày hết thử việc","type":"date","required":false},{"key":"salary","label":"Mức lương đề xuất","type":"money","required":false},{"key":"reason","label":"Lý do tuyển / ghi chú","type":"textarea","required":false}]',
  'sequential', 48, 1, 'public',
  '{"type":"hire","onboarding":true,"map":{"name":"name","email":"email","phone":"phone","birthday":"birthday","gender":"gender","title":"title","department":"department","manager":"manager","job_position":"job_position","office":"office","employee_type":"employee_type","hire_date":"hire_date","probation_end":"probation_end","note":"reason"}}'
WHERE NOT EXISTS (SELECT 1 FROM request_groups WHERE name = 'Đề xuất tuyển dụng');
