-- NPP Control Tower (npp.vanquang.xyz) dùng chung tài khoản Workspace (đăng nhập một lần, routes/sso.js).
-- Quyền dùng cấp theo từng người trong LDL Account → Ứng dụng; không tự cấp cho ai (OPT_IN_MODULES).
INSERT OR IGNORE INTO apps(key, enabled) VALUES ('npp', 1);
