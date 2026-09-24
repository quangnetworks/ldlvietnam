-- Đổi tên thương hiệu "Base" → "LDL" trong dữ liệu mẫu đã có sẵn (chỉ đúng các bản ghi mẫu, không đụng dữ liệu người dùng nhập)
UPDATE users SET name = 'LDL Demo 12' WHERE username = 'demo' AND name = 'Base Demo 12';
UPDATE chat_messages SET content = REPLACE(content, 'trên Base Office', 'trên LDL Office')
  WHERE content = 'Chào mọi người, Chính sách nhân sự 2026 đã được ban hành trên Base Office, mọi người xem giúp nhé!';
