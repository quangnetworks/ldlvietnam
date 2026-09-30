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
  assert.equal(s.territories.filter((t) => t.level === 'region').length, 2);
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
