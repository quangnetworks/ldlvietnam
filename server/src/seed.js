/**
 * Demo data. buildSeed() returns a list of [sql, params] statements with fixed ids so it can be
 * executed directly (Node) or exported as a plain .sql file for Cloudflare D1:
 *   node src/seed.js --sql > seed.sql && wrangler d1 execute DB --remote --file seed.sql
 */
import { hashPassword } from './auth.js';

const COLORS = ['#2d7ff9', '#20c997', '#f59f00', '#e8590c', '#7048e8', '#d6336c', '#0ca678', '#1098ad', '#ae3ec9', '#5c940d'];

const dateOffset = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const datetimeOffset = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().replace('T', ' ').slice(0, 19);
};

export async function buildSeed() {
  const S = [];
  const add = (sql, ...params) => S.push([sql, params]);
  add("INSERT OR REPLACE INTO settings(key, value) VALUES ('company_name', ?)", 'Công ty LDL Việt Nam');

  // ---------- Phòng ban
  const dep = {};
  [['bgd', 'Ban Giám đốc', 'BGD'], ['hcns', 'Phòng Hành chính Nhân sự', 'HCNS'], ['kd', 'Phòng Kinh doanh', 'KD'],
    ['mkt', 'Phòng Marketing', 'MKT'], ['kt', 'Phòng Kế toán', 'KT'], ['it', 'Phòng IT', 'IT']].forEach(([key, name, code], i) => {
    dep[key] = i + 1;
    add('INSERT INTO departments(id, name, code) VALUES (?,?,?)', dep[key], name, code);
  });

  // ---------- Người dùng (mật khẩu mặc định 123456)
  const hash = await hashPassword('123456');
  const users = {};
  const addUser = (key, username, name, title, depKey, role = 'member', manager = null) => {
    const id = Object.keys(users).length + 1;
    users[key] = id;
    add(`INSERT INTO users(id, username, password_hash, name, email, title, department_id, role, color, manager_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, id, username, hash, name, `${username}@ldlvietnam.vn`, title, dep[depKey], role,
    COLORS[(id - 1) % COLORS.length], manager ? users[manager] : null);
  };
  addUser('admin', 'admin', 'Quản trị hệ thống', 'Quản trị viên', 'it', 'admin');
  addUser('gd', 'giamdoc', 'Võ Trung Cang', 'Giám đốc', 'bgd', 'admin');
  add('UPDATE users SET is_owner = 1 WHERE id = ?', users.gd);
  addUser('hr', 'chilan', 'Đinh Phạm Chi Lan', 'Trưởng phòng HCNS', 'hcns', 'member', 'gd');
  addUser('kd', 'truongkd', 'Lê Trường Giang', 'Trưởng phòng Kinh doanh', 'kd', 'member', 'gd');
  addUser('mkt', 'minhtrang', 'Nguyễn Minh Trang', 'Trưởng phòng Marketing', 'mkt', 'member', 'gd');
  addUser('kt', 'thuhuyen', 'Nguyễn Thu Huyền', 'Kế toán trưởng', 'kt', 'member', 'gd');
  addUser('nv1', 'demo', 'LDL Demo 12', 'Nhân viên kinh doanh', 'kd', 'member', 'kd');
  addUser('nv2', 'phuonglinh', 'Nguyễn Phương Linh', 'Nhân viên kinh doanh', 'kd', 'member', 'kd');
  addUser('nv3', 'duylinh', 'Trần Duy Linh', 'Chuyên viên Marketing', 'mkt', 'member', 'mkt');
  addUser('nv4', 'hoangcong', 'Hoàng Công Hoan', 'Chuyên viên nhân sự', 'hcns', 'member', 'hr');

  // ---------- Office: danh mục
  const types = {};
  [['cs', 'Chính sách', 'CS'], ['ct', 'Chỉ thị', 'CT'], ['cv', 'Công văn', 'CV'],
    ['hd', 'Hợp đồng dịch vụ', 'HĐ'], ['qd', 'Quyết định', 'QĐ'], ['tb', 'Thông báo', 'TB']].forEach(([k, n, p], i) => {
    types[k] = i + 1;
    add('INSERT INTO doc_types(id, name, prefix) VALUES (?,?,?)', i + 1, n, p);
  });
  let folderId = 0;
  const folder = (name, parent = null) => {
    folderId += 1;
    add('INSERT INTO doc_folders(id, name, parent_id) VALUES (?,?,?)', folderId, name, parent);
    return folderId;
  };
  const fHn = folder('HÀ NỘI');
  const fHnNs = folder('Nhân sự', fHn);
  folder('Hành chính', fHn);
  const fHcm = folder('HỒ CHÍ MINH');
  const fHcmKd = folder('Kinh doanh', fHcm);
  const fCty = folder('CÔNG TY');

  let catId = 0;
  const cat = (name, parent = null) => {
    catId += 1;
    add('INSERT INTO doc_categories(id, name, parent_id) VALUES (?,?,?)', catId, name, parent);
    return catId;
  };
  cat('Chưa phân loại');
  const cHc = cat('Hành chính');
  const cNs = cat('Nhân sự');
  cat('Đào tạo', cNs);
  cat('Tuyển dụng', cNs);
  const cKd = cat('Phòng Kinh doanh');
  cat('Chế độ khen thưởng', cKd);
  cat('Chính sách ưu đãi', cKd);
  cat('Quy phạm pháp luật');
  const cSm = cat('Sale & MKT');
  cat('Marketing', cSm);
  cat('Sale', cSm);

  // ---------- Office: văn bản mẫu
  let docId = 0;
  const log = (type, id, userId, action, detail, at) =>
    add('INSERT INTO activity_logs(entity_type, entity_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?,?)', type, id, userId, action, detail, at);
  const addDoc = (d) => {
    docId += 1;
    const id = docId;
    const at = datetimeOffset(d.ago ?? 0);
    const creator = d.creator ?? d.issuer;
    add(`INSERT INTO documents(id, code, title, description, content, kind, type_id, folder_id, category_id,
        department_id, sender_department_id, issuer_id, creator_id, status, issued_at, effective_date, expire_date, created_at, updated_at, need_numbering)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, d.code ?? null, d.title, d.description ?? null, d.content ?? null, d.kind, d.type, d.folder ?? null, d.category ?? null,
    d.department ?? null, d.sender ?? null, d.issuer, creator, d.status, d.status === 'issued' ? at : null,
    d.effective ?? null, d.expire ?? null, at, at, d.numbering ? 1 : 0);
    (d.approvers || []).forEach((u, i) => add('INSERT INTO document_approvers(document_id, user_id, step, status, acted_at) VALUES (?,?,?,?,?)',
      id, u, i + 1, d.status === 'issued' ? 'approved' : 'pending', d.status === 'issued' ? at : null));
    for (const v of d.viewers || []) add('INSERT OR IGNORE INTO document_views(document_id, user_id) VALUES (?,?)', id, v);
    add('INSERT OR IGNORE INTO document_follows(document_id, user_id) VALUES (?,?)', id, creator);
    log('document', id, creator, 'created', 'Tạo văn bản', at);
    if (d.status === 'issued') log('document', id, d.issuer, 'issued', 'Văn bản đã được ban hành', at);
  };
  addDoc({
    code: 'CS/5/19-08', title: 'Chính sách nhân sự 2026', kind: 'notice', type: types.tb, folder: fHnNs, category: cNs,
    department: dep.hcns, issuer: users.hr, status: 'issued', ago: -3, viewers: [users.gd, users.kd, users.nv1],
    content: '<p>Căn cứ Điều lệ tổ chức và hoạt động của Công ty, Ban Giám đốc ban hành <b>Chính sách nhân sự năm 2026</b> áp dụng cho toàn bộ CBNV.</p><ol><li>Chế độ lương, thưởng theo hiệu quả công việc (KPI).</li><li>Chế độ nghỉ phép: 12 ngày/năm, cộng thêm 1 ngày cho mỗi 5 năm thâm niên.</li><li>Đào tạo nội bộ tối thiểu 24 giờ/năm.</li></ol><p>Chính sách có hiệu lực kể từ ngày ký.</p>',
  });
  addDoc({
    code: '16072025/TB-LDL', title: '[2025] BAN HÀNH CHÍNH SÁCH KINH DOANH QUÝ 3/2025', kind: 'notice', type: types.tb,
    folder: fHcmKd, category: cKd, department: dep.kd, issuer: users.gd, status: 'issued', ago: -70,
    viewers: [users.kd, users.nv1, users.nv2, users.hr, users.mkt, users.kt, users.nv3],
    content: '<p>Phòng Kinh doanh thông báo chính sách bán hàng áp dụng trong Quý 3/2025 cho hệ thống nhà phân phối.</p>',
  });
  addDoc({
    code: '09062025/TB-LDL', title: '[2025] BAN HÀNH CHÍNH SÁCH KINH DOANH QUÝ 3/2025', description: 'Phòng kinh doanh thông báo chính sách bán hàng quý 3/2025',
    kind: 'notice', type: types.tb, folder: fHcmKd, category: cKd, department: dep.kd, issuer: users.gd, status: 'issued', ago: -107,
    expire: dateOffset(-1), viewers: [users.kd, users.nv1, users.nv2],
    content: '<p>Chính sách giờ làm việc và tăng ca áp dụng cho Phòng Kinh doanh.</p>',
  });
  addDoc({
    code: '125/QĐ-LDL', title: 'Quyết định bổ nhiệm Trưởng phòng Marketing', kind: 'internal', type: types.qd, folder: fCty,
    category: cHc, department: dep.mkt, issuer: users.gd, status: 'issued', ago: -20, viewers: [users.mkt],
    content: '<p>Bổ nhiệm bà <b>Nguyễn Minh Trang</b> giữ chức vụ Trưởng phòng Marketing kể từ ngày ký.</p>',
  });
  addDoc({
    code: '88/CV-ĐT', title: 'Công văn đề nghị hợp tác phân phối khu vực miền Trung', kind: 'incoming', type: types.cv,
    category: cKd, department: dep.kd, sender: dep.kd, issuer: users.kd, status: 'issued', ago: -5,
    description: 'Đối tác đề nghị làm nhà phân phối cấp 1 tại Đà Nẵng, Quảng Nam',
  });
  addDoc({
    code: '45/CV-LDL', title: 'Công văn gửi đối tác về điều chỉnh giá bán 2026', kind: 'outgoing', type: types.cv,
    category: cKd, department: dep.kd, issuer: users.kd, status: 'issued', ago: -2,
  });
  addDoc({
    title: 'Quy chế chi tiêu nội bộ năm 2026', kind: 'internal', type: types.qd, category: cHc, department: dep.kt,
    issuer: users.kt, creator: users.kt, status: 'pending', ago: -1, approvers: [users.gd], numbering: true,
    content: '<p>Dự thảo quy chế chi tiêu nội bộ, trình Ban Giám đốc phê duyệt.</p>',
  });
  addDoc({
    title: 'Kế hoạch tuyển dụng Quý 4/2026', kind: 'internal', type: types.tb, category: cNs, department: dep.hcns,
    issuer: users.hr, creator: users.hr, status: 'pending', ago: 0, approvers: [users.admin, users.gd],
  });

  // ---------- Wework: dự án & phòng ban
  let projectId = 0;
  let listId = 0;
  const addProject = (name, kind, owner, members, color, lists, template = false) => {
    projectId += 1;
    const id = projectId;
    add('INSERT INTO projects(id, name, kind, owner_id, color, description, is_template) VALUES (?,?,?,?,?,?,?)',
      id, name, kind, owner, color, `Không gian làm việc của ${name}`, template ? 1 : 0);
    add("INSERT INTO project_members(project_id, user_id, role) VALUES (?,?, 'manager')", id, owner);
    for (const m of members) add("INSERT OR IGNORE INTO project_members(project_id, user_id, role) VALUES (?,?, 'member')", id, m);
    const ids = lists.map((l, i) => {
      listId += 1;
      add('INSERT INTO task_lists(id, project_id, name, position) VALUES (?,?,?,?)', listId, id, l, i + 1);
      return listId;
    });
    return { id, lists: ids };
  };
  const pMkt = addProject('Project MKT', 'project', users.mkt, [users.nv3, users.nv1, users.gd], '#2d7ff9', ['Kế hoạch', 'Triển khai', 'Nghiệm thu']);
  const pPura = addProject('DỰ ÁN LA PURA', 'project', users.kd, [users.nv1, users.nv2, users.mkt], '#0ca678', ['Khảo sát', 'Thiết kế', 'Thi công', 'Bàn giao']);
  const pMine = addProject('Công việc của Demo 12', 'project', users.nv1, [], '#7048e8', ['Việc cá nhân']);
  const dKd = addProject('Phòng Kinh doanh', 'department', users.kd, [users.nv1, users.nv2], '#e8590c', ['Khách hàng', 'Nhà phân phối', 'Báo cáo']);
  addProject('Phòng Hành chính Nhân sự', 'department', users.hr, [users.nv4], '#d6336c', ['Tuyển dụng', 'Đào tạo', 'Hành chính']);
  const tpl = addProject('Mẫu: Ra mắt sản phẩm', 'project', users.admin, [], '#1098ad', ['Nghiên cứu', 'Chuẩn bị', 'Ra mắt'], true);

  let taskId = 0;
  const addTask = (t) => {
    taskId += 1;
    const id = taskId;
    const at = datetimeOffset(t.ago ?? 0);
    add(`INSERT INTO tasks(id, project_id, list_id, parent_id, title, description, creator_id, assignee_id, status, priority,
        start_date, due_date, completed_at, recurring, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, t.project ?? null, t.list ?? null, t.parent ?? null, t.title, t.description ?? null, t.creator, t.assignee, t.status ?? 'todo',
    t.priority ?? 'normal', t.start ?? null, t.due ?? null, t.status === 'done' ? datetimeOffset(t.doneAgo ?? 0) : null,
    t.recurring ?? null, at, at);
    for (const f of t.followers || []) add('INSERT OR IGNORE INTO task_followers(task_id, user_id) VALUES (?,?)', id, f);
    (t.checklist || []).forEach((c, i) => add('INSERT INTO task_checklist(task_id, content, done, position) VALUES (?,?,?,?)', id, c[0], c[1] ? 1 : 0, i));
    log('task', id, t.creator, 'created', 'Tạo công việc', at);
    return id;
  };
  addTask({ project: pMine.id, list: pMine.lists[0], title: 'Têst', description: 'Nội dung mô tả về công việc được giao',
    creator: users.nv1, assignee: users.nv1, start: dateOffset(-17), due: dateOffset(-15), ago: -17 });
  const t1 = addTask({ project: pMkt.id, list: pMkt.lists[0], title: 'Lập kế hoạch truyền thông Quý 4', creator: users.mkt, assignee: users.nv3,
    status: 'doing', priority: 'important', start: dateOffset(-5), due: dateOffset(3), followers: [users.gd],
    checklist: [['Phân tích đối thủ', true], ['Xác định kênh truyền thông', true], ['Dự trù ngân sách', false]], ago: -5 });
  addTask({ project: pMkt.id, list: pMkt.lists[0], parent: t1, title: 'Khảo sát khách hàng mục tiêu', creator: users.nv3, assignee: users.nv3, status: 'done', ago: -4, doneAgo: -1, due: dateOffset(-1) });
  addTask({ project: pMkt.id, list: pMkt.lists[1], title: 'Thiết kế bộ nhận diện chiến dịch', creator: users.mkt, assignee: users.nv1,
    status: 'todo', priority: 'urgent', start: dateOffset(-1), due: dateOffset(1), ago: -2 });
  addTask({ project: pMkt.id, list: pMkt.lists[1], title: 'Chạy quảng cáo Facebook tháng 9', creator: users.mkt, assignee: users.nv3,
    status: 'doing', due: dateOffset(-2), ago: -12 });
  addTask({ project: pMkt.id, list: pMkt.lists[2], title: 'Báo cáo hiệu quả chiến dịch tháng 8', creator: users.mkt, assignee: users.nv3,
    status: 'done', due: dateOffset(-20), ago: -30, doneAgo: -18 });
  addTask({ project: pPura.id, list: pPura.lists[0], title: 'Khảo sát mặt bằng dự án', creator: users.kd, assignee: users.nv2,
    status: 'done', due: dateOffset(-10), ago: -25, doneAgo: -8 });
  addTask({ project: pPura.id, list: pPura.lists[1], title: 'Hoàn thiện bản vẽ thiết kế', creator: users.kd, assignee: users.nv1,
    status: 'review', due: dateOffset(-1), ago: -9 });
  addTask({ project: pPura.id, list: pPura.lists[2], title: 'Lên dự toán thi công', creator: users.kd, assignee: users.nv1,
    status: 'todo', priority: 'important', start: dateOffset(0), due: dateOffset(7), ago: -1, followers: [users.gd, users.kt] });
  addTask({ project: pPura.id, list: pPura.lists[3], title: 'Chuẩn bị hồ sơ bàn giao', creator: users.kd, assignee: users.nv2,
    status: 'todo', due: dateOffset(21), ago: -1 });
  addTask({ project: dKd.id, list: dKd.lists[1], title: 'Gọi điện chăm sóc NPP khu vực miền Bắc', creator: users.kd, assignee: users.nv1,
    status: 'doing', due: dateOffset(0), recurring: 'weekly', ago: -3 });
  addTask({ project: dKd.id, list: dKd.lists[2], title: 'Báo cáo doanh số tuần', creator: users.kd, assignee: users.nv2,
    status: 'todo', due: dateOffset(2), recurring: 'weekly', ago: -2 });
  addTask({ project: dKd.id, list: dKd.lists[0], title: 'Gửi báo giá cho khách hàng Hoàng Phát', creator: users.nv1, assignee: users.kd,
    status: 'failed', due: dateOffset(-6), ago: -14 });
  addTask({ project: tpl.id, list: tpl.lists[0], title: 'Nghiên cứu thị trường', creator: users.admin, assignee: users.admin });
  addTask({ project: tpl.id, list: tpl.lists[1], title: 'Chuẩn bị tài liệu bán hàng', creator: users.admin, assignee: users.admin });
  addTask({ project: tpl.id, list: tpl.lists[2], title: 'Tổ chức sự kiện ra mắt', creator: users.admin, assignee: users.admin });

  add('INSERT INTO goals(user_id, title, progress, due_date) VALUES (?,?,?,?)', users.nv1, 'Đạt doanh số 2 tỷ Quý 4', 35, dateOffset(90));

  // ---------- Account: quyền ứng dụng, nhóm người dùng, hồ sơ
  add("INSERT OR IGNORE INTO apps(key, enabled) VALUES ('office', 1), ('wework', 1), ('request', 1)");
  add("INSERT OR IGNORE INTO app_access(app_key, user_id) SELECT a.key, u.id FROM apps a CROSS JOIN users u WHERE u.role <> 'guest'");
  add("INSERT INTO user_groups(id, name, description) VALUES (1, 'Ban lãnh đạo', 'Giám đốc và các trưởng phòng'), (2, 'Văn thư - Hành chính', 'Tiếp nhận, cấp số và lưu trữ văn bản')");
  for (const k of ['gd', 'hr', 'kd', 'mkt', 'kt']) add('INSERT INTO user_group_members(group_id, user_id) VALUES (1, ?)', users[k]);
  for (const k of ['hr', 'nv4']) add('INSERT INTO user_group_members(group_id, user_id) VALUES (2, ?)', users[k]);
  add('UPDATE users SET birthday = ?, phone = ?, profile = ? WHERE id = ?', '1995-06-15', '0901 234 567', JSON.stringify({
    education: [{ title: 'Cử nhân Quản trị kinh doanh', place: 'Đại học Kinh tế Quốc dân', from: '2013', to: '2017' }],
    experience: [{ title: 'Nhân viên kinh doanh', place: 'Công ty LDL Việt Nam', from: '2020', to: '' }],
    awards: [{ title: 'Nhân viên xuất sắc năm 2025', place: 'Công ty LDL Việt Nam', from: '2025' }],
  }), users.nv1);

  // ---------- Request: người duyệt mặc định & đề xuất mẫu
  const grp = (name) => `(SELECT id FROM request_groups WHERE name = '${name}')`;
  add(`INSERT OR IGNORE INTO request_group_approvers(group_id, user_id, step) SELECT ${grp('Đề nghị tạm ứng')}, ?, 1 WHERE ${grp('Đề nghị tạm ứng')} IS NOT NULL`, users.kt);
  add(`INSERT OR IGNORE INTO request_group_approvers(group_id, user_id, step) SELECT ${grp('Đề nghị tạm ứng')}, ?, 2 WHERE ${grp('Đề nghị tạm ứng')} IS NOT NULL`, users.gd);
  add(`INSERT OR IGNORE INTO request_group_approvers(group_id, user_id, step) SELECT ${grp('Đề nghị thanh toán')}, ?, 1 WHERE ${grp('Đề nghị thanh toán')} IS NOT NULL`, users.kt);
  add(`INSERT OR IGNORE INTO request_group_approvers(group_id, user_id, step) SELECT ${grp('Đề xuất cấp văn phòng phẩm')}, ?, 1 WHERE ${grp('Đề xuất cấp văn phòng phẩm')} IS NOT NULL`, users.hr);
  add(`INSERT OR IGNORE INTO request_group_approvers(group_id, user_id, step) SELECT ${grp('Đề xuất cấp văn phòng phẩm')}, ?, 1 WHERE ${grp('Đề xuất cấp văn phòng phẩm')} IS NOT NULL`, users.nv4);
  add(`INSERT INTO requests(id, group_id, title, content, data, flow, creator_id, status, deadline_at, created_at, updated_at)
    SELECT 1, ${grp('Đề nghị tạm ứng')}, 'Tạm ứng chi phí khảo sát NPP miền Trung', 'Chi phí đi lại, lưu trú 3 ngày khảo sát thị trường Đà Nẵng.',
      ?, 'sequential', ?, 'pending', ?, ?, ? WHERE ${grp('Đề nghị tạm ứng')} IS NOT NULL`,
  JSON.stringify({ amount: 8500000, purpose: 'Khảo sát và làm việc với NPP khu vực Đà Nẵng, Quảng Nam', refund_date: dateOffset(14) }),
  users.nv1, datetimeOffset(1), datetimeOffset(-1), datetimeOffset(-1));
  add("INSERT OR IGNORE INTO request_approvers(request_id, user_id, step, status) SELECT 1, ?, 1, 'pending' WHERE EXISTS (SELECT 1 FROM requests WHERE id = 1)", users.kt);
  add("INSERT OR IGNORE INTO request_approvers(request_id, user_id, step, status) SELECT 1, ?, 2, 'pending' WHERE EXISTS (SELECT 1 FROM requests WHERE id = 1)", users.gd);
  add(`INSERT INTO requests(id, group_id, title, data, flow, creator_id, status, completed_at, created_at, updated_at)
    SELECT 2, ${grp('Đề xuất nghỉ phép')}, 'Nghỉ phép năm 2 ngày', ?, 'sequential', ?, 'approved', ?, ?, ? WHERE ${grp('Đề xuất nghỉ phép')} IS NOT NULL`,
  JSON.stringify({ from: dateOffset(-8), to: dateOffset(-7), kind: 'Nghỉ phép năm', reason: 'Việc gia đình' }),
  users.nv2, datetimeOffset(-9), datetimeOffset(-10), datetimeOffset(-9));
  add("INSERT OR IGNORE INTO request_approvers(request_id, user_id, step, status, comment, acted_at) SELECT 2, ?, 1, 'approved', 'Đồng ý', ? WHERE EXISTS (SELECT 1 FROM requests WHERE id = 2)", users.kd, datetimeOffset(-9));
  log('request', 1, users.nv1, 'created', 'Tạo đề xuất', datetimeOffset(-1));
  log('request', 2, users.nv2, 'created', 'Tạo đề xuất', datetimeOffset(-10));
  log('request', 2, users.kd, 'approved', 'Đã chấp thuận: Đồng ý', datetimeOffset(-9));

  // ---------- HRM: hồ sơ nhân sự
  const hr = [
    ['gd', 'LDL001', 'Nam', '2015-03-01', 'Không xác định thời hạn', null, 'working'],
    ['hr', 'LDL002', 'Nữ', '2018-06-15', 'Không xác định thời hạn', null, 'working'],
    ['kd', 'LDL003', 'Nam', '2019-01-10', 'Không xác định thời hạn', null, 'working'],
    ['mkt', 'LDL004', 'Nữ', '2020-09-01', 'Xác định thời hạn 36 tháng', dateOffset(20), 'working'],
    ['kt', 'LDL005', 'Nữ', '2017-04-03', 'Không xác định thời hạn', null, 'working'],
    ['nv1', 'LDL006', 'Nam', '2023-02-20', 'Xác định thời hạn 12 tháng', dateOffset(150), 'working'],
    ['nv2', 'LDL007', 'Nữ', '2024-05-06', 'Xác định thời hạn 12 tháng', dateOffset(25), 'working'],
    ['nv3', 'LDL008', 'Nam', dateOffset(-40), 'Thử việc', dateOffset(20), 'probation'],
    ['nv4', 'LDL009', 'Nam', '2022-11-14', 'Xác định thời hạn 24 tháng', dateOffset(300), 'working'],
  ];
  for (const [k, code, gender, hire, ctype, cend, status] of hr) {
    add(`INSERT INTO hr_profiles(user_id, employee_code, gender, hire_date, contract_type, contract_end, probation_end, work_status)
      VALUES (?,?,?,?,?,?,?,?)`, users[k], code, gender, hire, ctype, cend, status === 'probation' ? dateOffset(20) : null, status);
  }
  add("INSERT OR REPLACE INTO settings(key, value) VALUES ('hrm_settings', ?)", JSON.stringify({ managers: [users.hr] }));

  // ---------- Checkin: vài ngày chấm công gần đây (giờ VN = UTC+7)
  const utcAt = (day, vnMinutes) => {
    const m = vnMinutes - 7 * 60;
    return `${day} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
  };
  for (let d = 1; d <= 6; d++) {
    const day = dateOffset(-d);
    if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) continue;
    for (const [k, inAt] of [['nv1', 8 * 60 + 25], ['nv2', 8 * 60 + 35 + d * 3], ['kd', 8 * 60 + 15], ['hr', 8 * 60 + 28]]) {
      add('INSERT OR IGNORE INTO checkins(user_id, date, check_in_at, check_out_at) VALUES (?,?,?,?)', users[k], day,
        utcAt(day, inAt), utcAt(day, 17 * 60 + 30 + d));
    }
  }

  // ---------- Drive: tài liệu công ty & cá nhân
  add("INSERT INTO drive_items(id, space, kind, name, owner_id) VALUES (1, 'company', 'folder', 'Quy chế - Chính sách', ?)", users.hr);
  add("INSERT INTO drive_items(id, space, kind, name, owner_id) VALUES (2, 'company', 'folder', 'Biểu mẫu', ?)", users.hr);
  add("INSERT INTO drive_items(id, space, kind, name, owner_id) VALUES (3, 'company', 'folder', 'Tài liệu bán hàng', ?)", users.kd);
  add("INSERT INTO drive_items(id, space, kind, name, owner_id) VALUES (4, 'personal', 'folder', 'Khách hàng 2026', ?)", users.nv1);
  add("INSERT INTO drive_shares(item_id, department_id, permission) VALUES (4, ?, 'view')", dep.kd);

  // ---------- Message: kênh chung & tin nhắn mẫu
  add("INSERT OR IGNORE INTO chat_channels(id, name, description, kind, created_by, last_message_at) VALUES (1, 'chung', 'Kênh trao đổi chung toàn công ty', 'public', ?, ?)", users.admin, datetimeOffset(0));
  add("INSERT INTO chat_channels(id, name, description, kind, created_by, last_message_at) VALUES (2, 'kinh-doanh', 'Phòng Kinh doanh', 'private', ?, ?)", users.kd, datetimeOffset(0));
  for (const k of ['kd', 'nv1', 'nv2', 'gd']) add('INSERT INTO chat_members(channel_id, user_id) VALUES (2, ?)', users[k]);
  add('INSERT INTO chat_messages(channel_id, user_id, content, created_at) VALUES (1, ?, ?, ?)', users.hr, 'Chào mọi người, Chính sách nhân sự 2026 đã được ban hành trên LDL Office, mọi người xem giúp nhé!', datetimeOffset(-1));
  add('INSERT INTO chat_messages(channel_id, user_id, content, created_at) VALUES (1, ?, ?, ?)', users.gd, 'Cảm ơn chị Chi Lan. Các trưởng phòng phổ biến lại cho nhân viên trong tuần này.', datetimeOffset(-1));
  add('INSERT INTO chat_messages(channel_id, user_id, content, created_at) VALUES (2, ?, ?, ?)', users.kd, '@demo em gửi báo giá cho NPP Hà Nam trước thứ 6 nhé.', datetimeOffset(0));

  // Kênh phòng ban (các phòng ban còn lại được tạo tự động khi thành viên mở chat)
  add("INSERT INTO chat_channels(id, name, description, kind, department_id, last_message_at) VALUES (3, 'Phòng Kinh doanh', 'Kênh trao đổi nội bộ Phòng Kinh doanh', 'department', ?, ?)", dep.kd, datetimeOffset(0));
  add('INSERT INTO chat_messages(channel_id, user_id, content, created_at) VALUES (3, ?, ?, ?)', users.kd, 'Cả phòng cập nhật doanh số tuần vào LDL Wework trước 17h thứ 6 nhé.', datetimeOffset(-1));
  add('INSERT INTO chat_messages(channel_id, user_id, content, created_at) VALUES (3, ?, ?, ?)', users.nv2, 'Dạ vâng anh, em đang tổng hợp số của khu vực miền Bắc.', datetimeOffset(0));

  // ---------- Tài khoản khách (đối tác NPP) chỉ dùng LDL Request
  add(`INSERT INTO users(id, username, password_hash, name, email, title, role, color, expires_at) VALUES (11, 'npp.hanam', ?, 'NPP Hà Nam (khách)', 'npp.hanam@partner.vn', 'Nhà phân phối', 'guest', '#868e96', ?)`,
    hash, dateOffset(90));
  add("INSERT OR IGNORE INTO app_access(app_key, user_id) VALUES ('request', 11)");
  add("INSERT INTO notifications(user_id, actor_id, app, type, title, link) VALUES (?,?, 'wework', 'assigned', ?, '/wework')",
    users.nv1, users.mkt, 'Nguyễn Minh Trang đã giao cho bạn công việc "Thiết kế bộ nhận diện chiến dịch"');
  // trưởng phòng (được giao việc cho mọi nhân sự trong phòng ban)
  for (const [dk, uk] of [['kd', 'kd'], ['mkt', 'mkt'], ['hcns', 'hr'], ['kt', 'kt']]) {
    if (dep[dk] && users[uk]) add('UPDATE departments SET head_id = ? WHERE id = ?', users[uk], dep[dk]);
  }
  return S;
}

const TABLES = ['chat_messages', 'chat_members', 'chat_channels', 'drive_shares', 'drive_items', 'leave_quotas', 'checkins', 'hr_profiles',
  'webhook_logs', 'webhooks', 'request_attachments', 'request_comments', 'request_stars', 'request_followers', 'request_approvers', 'requests',
  'request_group_stars', 'request_group_followers', 'request_group_approvers', 'notes', 'user_prefs', 'login_logs', 'app_access',
  'user_departments', 'user_group_members', 'user_groups', 'notifications', 'activity_logs', 'custom_filters', 'goals', 'task_attachments', 'task_results', 'task_comments', 'request_group_files', 'task_checklist',
  'task_stars', 'task_followers', 'tasks', 'task_lists', 'project_departments', 'project_members', 'projects', 'document_comments', 'document_views',
  'document_stars', 'document_follows', 'document_recipients', 'document_approvers', 'document_attachments', 'documents',
  'doc_categories', 'doc_folders', 'doc_types', 'users', 'departments'];

export const resetStatements = () => TABLES.map((t) => [`DELETE FROM ${t}`, []]);

/** Render statements as a standalone SQL script (for `wrangler d1 execute --file`). */
export function toSqlScript(stmts) {
  const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  return stmts.map(([sql, params]) => {
    let i = 0;
    return `${sql.replace(/\?/g, () => lit(params[i++])).replace(/\s*\n\s*/g, ' ')};`;
  }).join('\n') + '\n';
}

// CLI: `node src/seed.js --sql [--reset]` prints a SQL script to stdout
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('seed.js') && process.argv.includes('--sql')) {
  const stmts = await buildSeed();
  process.stdout.write(toSqlScript([...(process.argv.includes('--reset') ? resetStatements() : []), ...stmts]));
}
