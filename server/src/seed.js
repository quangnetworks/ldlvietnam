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
  add("INSERT OR REPLACE INTO settings(key, value) VALUES ('company_name', ?)", 'CÔNG TY CỔ PHẦN LDL VIỆT NAM');

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
  addUser('hr', 'chilan', 'Đinh Phạm Chi Lan', 'Trưởng phòng HCNS', 'hcns', 'member', 'gd');
  addUser('kd', 'truongkd', 'Lê Trường Giang', 'Trưởng phòng Kinh doanh', 'kd', 'member', 'gd');
  addUser('mkt', 'minhtrang', 'Nguyễn Minh Trang', 'Trưởng phòng Marketing', 'mkt', 'member', 'gd');
  addUser('kt', 'thuhuyen', 'Nguyễn Thu Huyền', 'Kế toán trưởng', 'kt', 'member', 'gd');
  addUser('nv1', 'demo', 'Base Demo 12', 'Nhân viên kinh doanh', 'kd', 'member', 'kd');
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
  add("INSERT INTO notifications(user_id, actor_id, app, type, title, link) VALUES (?,?, 'wework', 'assigned', ?, '/wework')",
    users.nv1, users.mkt, 'Nguyễn Minh Trang đã giao cho bạn công việc "Thiết kế bộ nhận diện chiến dịch"');
  return S;
}

const TABLES = ['notifications', 'activity_logs', 'custom_filters', 'goals', 'task_attachments', 'task_comments', 'task_checklist',
  'task_stars', 'task_followers', 'tasks', 'task_lists', 'project_members', 'projects', 'document_comments', 'document_views',
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
