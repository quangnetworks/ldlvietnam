import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ldl-sales-'));
process.env.JWT_SECRET = 'test-secret';
const { initNode } = await import('../src/node.js');
const { createApp } = await import('../src/app.js');

let app;
const base = 'http://test.local/api';
before(async () => { await initNode({ dataDir: tmp, reset: true }); app = createApp(); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function raw(url, opts = {}) {
  const r = await app.fetch(new Request(base + url, opts));
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  return { status: r.status, data, headers: r.headers };
}
async function login(username, extra = {}, headers = {}) {
  const res = await raw('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ username, password: '123456', ...extra }) });
  if (res.status !== 200) return { fail: res };
  const { token, user } = res.data;
  const call = (method, url, body) => {
    const opts = { method, headers: { Authorization: `Bearer ${token}`, ...headers } };
    if (body instanceof FormData) opts.body = body;
    else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return raw(url, opts);
  };
  return { user, get: (u) => call('GET', u), post: (u, b) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u) };
}

test('sales structure: territory tree, members with concurrent posts, manager sync, recursive visibility, multi-level approval', async () => {
  const demo = await login('demo');
  const s = (await demo.get('/sales/structure')).data;
  assert.equal(s.can_manage, false);
  const T = (name, level) => s.territories.find((t) => t.name === name && (!level || t.level === level));
  assert.equal(T('Toàn quốc').level, 'national');
  assert.equal(s.territories.filter((t) => t.level === 'region').length, 3);
  assert.equal(s.territories.filter((t) => t.level === 'area').length, 10);
  assert.ok(s.members.some((m) => m.username === 'demo' && m.role === 'SS' && m.is_concurrent === 1));
  assert.equal((await demo.post('/sales/territories', { parent_id: T('Đông Tây Bắc').id, name: 'Phú Thọ' })).status, 403);
  assert.equal((await (await login('npp.hanam')).get('/sales/structure')).status, 403);

  const hr = await login('chilan');
  // thêm nhiều tỉnh một lần; trùng tên bị bỏ qua
  assert.equal((await hr.post('/sales/territories', { parent_id: T('Đông Tây Bắc').id, names: 'Phú Thọ\nHòa Bình\nThái Nguyên' })).data.added, 2);
  assert.equal((await hr.post('/sales/territories', { parent_id: T('Đông Tây Bắc').id, names: 'Phú Thọ' })).status, 400);
  const users = (await hr.get('/users')).data;
  const id = (u) => users.find((x) => x.username === u).id;
  // vị trí phải khớp cấp địa bàn
  assert.equal((await hr.post(`/sales/territories/${T('Hà Nội', 'province').id}/members`, { user_id: id('duylinh'), role: 'ASM' })).status, 400);
  await hr.post(`/sales/territories/${T('Hà Nội', 'area').id}/members`, { user_id: id('duylinh'), role: 'ASM' });
  await hr.post(`/sales/territories/${T('Nam Hà Nội').id}/members`, { user_id: id('duylinh'), role: 'ASM', is_concurrent: true }); // kiêm nhiệm
  await hr.post(`/sales/territories/${T('Hà Nội', 'province').id}/members`, { user_id: id('hoangcong'), role: 'SREP' });
  const me = (await hr.get(`/sales/users/${id('duylinh')}`)).data;
  assert.deepEqual(me.map((x) => [x.territory_name, x.is_concurrent]), [['Hà Nội', 0], ['Nam Hà Nội', 1]]);
  assert.equal(users.find((u) => u.username === 'duylinh').sales_role ?? null, null);
  assert.equal((await hr.get('/users')).data.find((u) => u.username === 'duylinh').sales_role, 'ASM');

  // đồng bộ quản lý trực tiếp theo cơ cấu: SREP → SS cùng tỉnh, SS → ASM khu vực, SREP KA (cấp khu vực) → ASM, ASM → NSM
  const plan = (await hr.get('/sales/sync-managers')).data;
  const mgr = (u) => plan.find((p) => p.user_id === id(u))?.manager_id;
  assert.equal(mgr('hoangcong'), id('demo'));
  assert.equal(mgr('demo'), id('duylinh'));
  assert.equal(mgr('phuonglinh'), id('duylinh'));
  assert.equal(mgr('duylinh'), id('truongkd'));
  assert.equal(mgr('truongkd'), undefined);
  assert.equal((await hr.post('/sales/sync-managers', {})).data.updated, 4);
  assert.equal((await hr.get('/sales/sync-managers')).data.filter((p) => p.changed).length, 0);

  // cấp trên xem được toàn bộ cấp dưới (NSM → ASM → SS → SREP)
  const kd = await login('truongkd');
  assert.equal((await kd.get(`/hrm/employees/${id('hoangcong')}`)).status, 200);
  const team = (await kd.get('/wework/members?team=1')).data.map((e) => e.username);
  for (const u of ['duylinh', 'demo', 'phuonglinh', 'hoangcong']) assert.ok(team.includes(u), u);
  assert.equal((await (await login('minhtrang')).get(`/hrm/employees/${id('hoangcong')}`)).status, 403);

  // lọc nhân sự theo địa bàn (gồm địa bàn con) và vị trí
  const north = (await hr.get(`/hrm/employees?territory_id=${T('Miền Bắc').id}`)).data.map((e) => e.username).sort();
  assert.deepEqual(north, ['demo', 'duylinh', 'hoangcong', 'phuonglinh']);
  assert.deepEqual((await hr.get('/hrm/employees?sales_role=SS')).data.map((e) => e.username), ['demo']);
  assert.ok((await hr.get('/hrm/report')).data.by_sales.find((x) => x.name === 'ASM').c === 1);

  // đề xuất duyệt qua 3 cấp quản lý: SS → ASM → NSM
  const admin = await login('admin');
  const g = (await admin.post('/request-groups', { name: 'Đề xuất chi phí thị trường', fields: [], approvers: [], manager_approval: true, manager_levels: 3 })).data;
  const steps = (await (await login('hoangcong')).get(`/request-groups/${g.id}/plan`)).data.steps;
  assert.deepEqual(steps.map((x) => [x.stage, x.user_id]), [['manager', id('demo')], ['manager', id('duylinh')], ['manager', id('truongkd')]]);

  // xoá khu vực: xoá cả tỉnh con và phân công, cập nhật vị trí
  assert.equal((await hr.del(`/sales/territories/${T('Toàn quốc').id}`)).status, 400);
  await hr.del(`/sales/territories/${T('Hà Nội', 'area').id}`);
  const after = (await hr.get('/sales/structure')).data;
  assert.ok(!after.territories.some((t) => t.name === 'Hà Nội'));
  assert.equal((await hr.get('/users')).data.find((u) => u.username === 'hoangcong').sales_role, null);
  assert.equal((await hr.get('/users')).data.find((u) => u.username === 'duylinh').sales_role, 'ASM'); // còn kiêm nhiệm Nam Hà Nội
});

test('sales by industry (HMP / TP) on 3 regions; HRM import creates accounts with profile, sales post, history and contracts', async () => {
  const hr = await login('chilan');
  const s = (await hr.get('/sales/structure')).data;
  const T = (name) => s.territories.find((t) => t.name === name);
  assert.deepEqual(s.territories.filter((t) => t.level === 'region').map((t) => t.name), ['Miền Bắc', 'Miền Trung', 'Miền Nam']);
  assert.equal(T('Bắc Miền Trung').parent_id, T('Miền Trung').id);
  assert.equal(T('Hồ Chí Minh').parent_id, T('Miền Nam').id);
  assert.deepEqual(s.industries.map((x) => x.code), ['HMP', 'TP']);
  assert.equal(s.members.find((m) => m.role === 'SS').industry, 'HMP');

  const rows = [
    { username: 'asm.dnb.tp', name: 'Phạm ASM Thực phẩm', department: 'Phòng Kinh doanh', sales_role: 'ASM', territory: 'Đông Nam Bộ', industry: 'Thực phẩm' },
    { username: 'asm.dnb.hmp', name: 'Phạm ASM Hóa mỹ phẩm', sales_role: 'ASM', territory: 'Đông Nam Bộ', industry: 'HMP' },
    { username: 'ss.dn', name: 'Lê SS Đồng Nai', sales_role: 'SS', territory: 'Đồng Nai', industry: 'HMP' },
    { employee_code: 'LDL100', name: 'Nguyễn Văn SREP', email: 'srep100@ldlvietnam.vn', manager_username: 'truongkd', hire_date: '01/03/2024',
      work_status: 'Chính thức', gender: 'Nam', sales_role: 'SREP', territory: 'Đồng Nai', industry: 'TP', title: 'Quản trị kho' },
    { username: 'cu.nv', name: 'Nhân viên cũ', work_status: 'Đã nghỉ việc', resign_date: '2023-12-31' },
    { username: 'demo', phone: '0909 000 111' },
    { username: 'loi', name: 'Sai địa bàn', sales_role: 'SS', territory: 'Không có' },
  ];
  assert.equal((await hr.post('/hrm/employees/import', { rows, create_accounts: true })).status, 400); // thiếu mật khẩu mặc định
  const res = (await hr.post('/hrm/employees/import', {
    rows, create_accounts: true, password: 'Ldl@2026',
    careers: [
      { employee_code: 'LDL100', type: 'Khen thưởng', effective_date: '15/06/2024', to_value: 'Nhân viên xuất sắc quý 2' },
      { employee_code: 'LDL100', type: 'Khen thưởng', effective_date: '15/06/2024', to_value: 'Nhân viên xuất sắc quý 2' },
      { username: 'cu.nv', type: 'Thăng tiến', effective_date: '2022-01-01', from_value: 'Nhân viên', to_value: 'Trưởng nhóm' },
      { username: 'khongco', type: 'Kỷ luật', effective_date: '2024-01-01' },
    ],
    contracts: [
      { employee_code: 'LDL100', code: 'HĐ-100', contract_type: 'Xác định thời hạn 12 tháng', start_date: '01/03/2024', end_date: '28/02/2025', status: 'Đã hết hạn' },
      { employee_code: 'LDL100', code: 'HĐ-101', contract_type: 'Không xác định thời hạn', start_date: '01/03/2025', salary: '12.000.000' },
    ],
  })).data;
  assert.equal(res.created, 6);                           // 5 dòng mới hợp lệ + "loi" (tài khoản tạo được, chỉ sai địa bàn)
  assert.ok(res.new_accounts.includes('ldl100'));          // thiếu tài khoản → dùng mã NV
  assert.equal(res.updated, 1);
  assert.equal(res.assignments, 4);
  assert.equal(res.careers, 2);
  assert.equal(res.skipped, 1);
  assert.equal(res.contracts, 2);
  assert.ok(res.errors.some((e) => /Quản trị kho/.test(e)));
  assert.ok(res.errors.some((e) => /Không có/.test(e)));
  assert.ok(res.errors.some((e) => /khongco/.test(e)));

  const users = (await hr.get('/users')).data;
  const id = (u) => users.find((x) => x.username === u)?.id;
  const srep = (await hr.get(`/hrm/employees/${id('ldl100')}`)).data;
  assert.equal(srep.employee_code, 'LDL100');
  assert.equal(srep.hire_date, '2024-03-01');
  assert.equal(srep.contract_type, 'Không xác định thời hạn');
  assert.equal(srep.manager_id, id('truongkd'));
  assert.equal(srep.title, null);
  assert.equal(srep.sales_role, 'SREP');
  assert.equal(srep.sales_industry, 'TP');
  assert.equal(users.find((u) => u.username === 'demo').phone, '0909 000 111');
  assert.equal((await hr.get(`/hrm/employees/${id('ldl100')}/careers`)).data.length, 1);
  assert.equal((await hr.get(`/hrm/employees/${id('ldl100')}/contracts`)).data.length, 2);
  // tài khoản mới đăng nhập bằng mật khẩu mặc định; nhân viên đã nghỉ việc bị khoá
  assert.ok((await login('ldl100', { password: 'Ldl@2026' })).user);
  assert.ok((await login('cu.nv', { password: 'Ldl@2026' })).fail);

  // cấp trên theo ngành hàng: SREP TP bỏ qua SS HMP cùng tỉnh → ASM TP; SS HMP → ASM HMP
  const plan = (await hr.get('/sales/sync-managers')).data;
  const mgr = (u) => plan.find((p) => p.user_id === id(u))?.manager_id;
  assert.equal(mgr('ldl100'), id('asm.dnb.tp'));
  assert.equal(mgr('ss.dn'), id('asm.dnb.hmp'));
  assert.equal(mgr('asm.dnb.tp'), id('truongkd'));

  // lọc HRM theo ngành hàng, báo cáo theo ngành
  const tp = (await hr.get('/hrm/employees?industry=TP')).data.map((e) => e.username);
  assert.ok(tp.includes('ldl100') && tp.includes('asm.dnb.tp') && !tp.includes('ss.dn'));
  assert.ok((await hr.get('/hrm/report')).data.by_industry.some((x) => x.name === 'Thực phẩm' && x.c >= 2));

  // danh mục ngành hàng: không xoá được ngành đang có người phụ trách
  assert.equal((await (await login('demo')).put('/sales/settings', { industries: [] })).status, 403);
  assert.equal((await hr.put('/sales/settings', { industries: [{ code: 'HMP', name: 'Hóa mỹ phẩm' }] })).status, 400);
  const next = (await hr.put('/sales/settings', { industries: [...s.industries, { code: 'dl', name: 'Đồ uống' }] })).data;
  assert.deepEqual(next.industries.map((x) => x.code), ['HMP', 'TP', 'DL']);
});
