-- ================= Quy mô 300+ nhân sự: chỉ mục cho các truy vấn lọc / đếm thường xuyên =================
-- Wework: công việc con, người tạo, danh sách theo trạng thái / thời hạn / cập nhật, đếm checklist & bình luận
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status ON tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at);
CREATE INDEX IF NOT EXISTS idx_task_checklist_task ON task_checklist(task_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_followers_user ON task_followers(user_id);
CREATE INDEX IF NOT EXISTS idx_task_stars_user ON task_stars(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);
-- Cơ cấu tổ chức: cấp dưới nhiều tầng (đệ quy theo quản lý trực tiếp), thành viên phòng ban
CREATE INDEX IF NOT EXISTS idx_users_manager ON users(manager_id);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
-- Request: hộp "cần duyệt", theo dõi, trạng thái
CREATE INDEX IF NOT EXISTS idx_request_approvers_user ON request_approvers(user_id, status);
CREATE INDEX IF NOT EXISTS idx_request_followers_user ON request_followers(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_requests_group ON requests(group_id);
-- Office: người nhận văn bản
CREATE INDEX IF NOT EXISTS idx_document_recipients_doc ON document_recipients(document_id);
CREATE INDEX IF NOT EXISTS idx_document_recipients_user ON document_recipients(user_id);
CREATE INDEX IF NOT EXISTS idx_document_approvers_user ON document_approvers(user_id);
-- Chấm công theo ngày (bảng công nhân viên), chat theo người, nhật ký theo người
CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(date);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id, id);
CREATE INDEX IF NOT EXISTS idx_territory_members_industry ON territory_members(industry);
-- Tài khoản: ứng dụng được cấp, phòng ban kiêm nhiệm, nhóm người dùng — tra theo người (danh sách thành viên, đăng nhập)
CREATE INDEX IF NOT EXISTS idx_app_access_user ON app_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_group_members_user ON user_group_members(user_id);
