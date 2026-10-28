import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ldl-supply-'));
process.env.JWT_SECRET = 'test-secret';
const { initNode } = await import('../src/node.js');
const { createApp } = await import('../src/app.js');

let app;
const base = 'http://test.local/api';
before(async () => {
  await initNode({ dataDir: tmp, reset: true });
  app = createApp();
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function login(username, password = '123456') {
  const res = await app.fetch(new Request(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  }));
  assert.equal(res.status, 200, `login ${username}`);
  const { token, user } = await res.json();
  const call = async (method, url, body) => {
    const opts = { method, headers: { Authorization: `Bearer ${token}` } };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const r = await app.fetch(new Request(base + url, opts));
    return { status: r.status, data: await r.json() };
  };
  return { user, get: (u) => call('GET', u), post: (u, b) => call('POST', u, b), put: (u, b) => call('PUT', u, b) };
}

test('supplies: uniforms and carts are tracked by quantity per holder, including people without an account and partners', async () => {
  const hr = await login('chilan');
  const demo = await login('demo');
  assert.equal((await demo.get('/asset/supplies')).status, 403);

  const shirt = (await hr.post('/asset/supply-items', { name: 'Áo đồng phục', unit: 'cái', penalty: 500000 })).data.id;
  const cart = (await hr.post('/asset/supply-items', { name: 'Xe kéo', unit: 'chiếc' })).data.id;
  assert.equal((await hr.post('/asset/supply-items', { name: 'áo đồng phục' })).status, 400);

  const ps = (await hr.post('/asset/supply-holders', { name: 'Nguyễn Văn PS', role: 'PS', area: 'Kiên Giang' })).data.id;
  const pg = (await hr.post('/asset/supply-holders', { name: 'Trần Thị PG', role: 'PG', area: 'Kiên Giang' })).data.id;
  const npp = (await hr.post('/asset/supply-holders', { name: 'NPP Hùng Vỹ Phúc', kind: 'partner' })).data.id;

  // số dư đầu kỳ, chuyển giao cho PG và NPP, không chuyển quá số đang giữ
  await hr.post('/asset/supply-moves', { kind: 'opening', to_holder_id: ps, lines: [{ item_id: shirt, qty: 22 }, { item_id: cart, qty: 7 }] });
  await hr.post('/asset/supply-moves', { kind: 'transfer', from_holder_id: ps, to_holder_id: pg, lines: [{ item_id: shirt, qty: 2 }, { item_id: cart, qty: 1 }] });
  await hr.post('/asset/supply-moves', { kind: 'transfer', from_holder_id: ps, to_holder_id: npp, lines: [{ item_id: cart, qty: 4 }] });
  const over = await hr.post('/asset/supply-moves', { kind: 'transfer', from_holder_id: ps, to_holder_id: pg, lines: [{ item_id: cart, qty: 3 }] });
  assert.equal(over.status, 400);
  assert.match(over.data.error, /chỉ đang giữ 2/);

  // hỏng 1 xe; trả 5 áo về kho
  await hr.post('/asset/supply-moves', { kind: 'writeoff', from_holder_id: ps, reason: 'damaged', lines: [{ item_id: cart, qty: 1 }] });
  await hr.post('/asset/supply-moves', { kind: 'return', from_holder_id: ps, lines: [{ item_id: shirt, qty: 5 }] });

  const s = (await hr.get('/asset/supplies')).data;
  const bal = (id) => s.holders.find((h) => h.id === id).balances;
  assert.deepEqual(bal(ps), { [shirt]: 15, [cart]: 1 });
  assert.deepEqual(bal(pg), { [shirt]: 2, [cart]: 1 });
  assert.deepEqual(bal(npp), { [cart]: 4 });
  // kho chưa có phiếu nhập → không theo dõi tồn
  assert.equal(s.warehouse[shirt], null);

  // nhập kho rồi cấp phát: không cấp quá tồn
  await hr.post('/asset/supply-moves', { kind: 'receive', lines: [{ item_id: cart, qty: 3 }] });
  assert.equal((await hr.post('/asset/supply-moves', { kind: 'issue', to_holder_id: pg, lines: [{ item_id: cart, qty: 4 }] })).status, 400);
  await hr.post('/asset/supply-moves', { kind: 'issue', to_holder_id: pg, lines: [{ item_id: cart, qty: 3 }] });
  assert.equal((await hr.get('/asset/supplies')).data.warehouse[cart], 0);

  // huỷ dòng ghi nhầm: PG đã nhận 2 áo — huỷ được vì PG vẫn còn giữ
  const moves = (await hr.get(`/asset/supply-moves?holder_id=${pg}`)).data;
  const tr = moves.find((m) => m.kind === 'transfer' && m.item_id === shirt);
  assert.equal((await hr.post(`/asset/supply-moves/${tr.id}/void`, {})).status, 200);
  assert.equal((await hr.get('/asset/supplies')).data.holders.find((h) => h.id === ps).balances[shirt], 17);
});

test('supplies: offboarding waits until uniforms are returned or written off', async () => {
  const hr = await login('chilan');
  const pl = await login('duylinh');
  const shirt = (await hr.post('/asset/supply-items', { name: 'Nón', unit: 'cái' })).data.id;
  const h = (await hr.post('/asset/supply-holders', { name: pl.user.name, user_id: pl.user.id, role: 'NV' })).data.id;
  assert.equal((await hr.post('/asset/supply-holders', { name: 'Trùng', user_id: pl.user.id })).status, 400);
  await hr.post('/asset/supply-moves', { kind: 'issue', to_holder_id: h, lines: [{ item_id: shirt, qty: 2 }] });

  // hồ sơ tài sản của nhân sự hiện CCDC đang giữ
  assert.equal((await hr.get(`/asset/people/${pl.user.id}`)).data.supplies[0].qty, 2);

  const p = (await hr.post('/asset/procedures', { kind: 'offboard', user_id: pl.user.id, effective_date: '2026-12-31' })).data;
  assert.equal(p.supplies.length, 1);
  assert.equal(p.steps.find((s) => s.key === 'assets')?.done ?? false, false);
  for (const st of p.steps.filter((x) => x.key !== 'assets')) await hr.put(`/asset/procedures/${p.id}/steps`, { key: st.key, done: true });
  assert.equal((await hr.post(`/asset/procedures/${p.id}/complete`, {})).status, 400);

  // trả 1, mất 1 (ghi nhận bồi thường) → hoàn tất được
  await hr.post('/asset/supply-moves', { kind: 'return', from_holder_id: h, lines: [{ item_id: shirt, qty: 1 }] });
  await hr.post('/asset/supply-moves', { kind: 'writeoff', from_holder_id: h, reason: 'lost', lines: [{ item_id: shirt, qty: 1, charge: 500000 }] });
  const after = (await hr.get(`/asset/procedures/${p.id}`)).data;
  assert.equal(after.supplies.length, 0);
  assert.equal(after.can_complete, true);
});

async function upload(token, url, fields, withPhoto) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  if (withPhoto) fd.append('files', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'tu-mat.jpg');
  const r = await app.fetch(new Request(base + url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd }));
  return { status: r.status, data: await r.json() };
}
async function tokenOf(username) {
  const res = await app.fetch(new Request(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: '123456' }) }));
  return (await res.json()).token;
}

test('market assets: placed at a distributor under a responsible rep, checked on site with a photo, recalled when the distributor ends', async () => {
  const hr = await login('chilan');
  const demo = await login('demo');
  const other = await login('hoangcong');
  const a = (await hr.post('/assets', { name: 'Tủ mát Sanaky 400L', type: 'Tủ mát, tủ trưng bày', price: 9000000 })).data.items[0];
  assert.equal((await demo.post(`/assets/${a.id}/place`, { partner: 'NPP Hùng Vỹ Phúc' })).status, 403);
  const pr = await hr.post(`/assets/${a.id}/place`, { partner: 'NPP Hùng Vỹ Phúc', outlet: 'Tạp hoá Cô Ba', area: 'Kiên Giang', responsible_id: demo.user.id, agreement_until: '2027-06-30' });
  assert.equal(pr.status, 200, JSON.stringify(pr.data) + JSON.stringify(a));
  const placed = pr.data;
  assert.equal(placed.placement, 'market');
  assert.equal(placed.holder_id, demo.user.id); // trách nhiệm qua biên bản bàn giao
  assert.equal(placed.status, 'in_use');
  const m = (await hr.get('/asset/market')).data;
  assert.equal(m.assets.find((x) => x.id === a.id).check_overdue, true);

  // người phụ trách kiểm tra: bắt buộc ảnh; người khác không được
  const tDemo = await tokenOf('demo');
  assert.equal((await upload(tDemo, `/assets/${a.id}/checks`, { result: 'ok' }, false)).status, 400);
  assert.equal((await upload(await tokenOf('hoangcong'), `/assets/${a.id}/checks`, { result: 'ok' }, true)).status, 403);
  const ck = await upload(tDemo, `/assets/${a.id}/checks`, { result: 'damaged', lat: 10.01, lng: 105.08, accuracy: 12, note: 'Cửa tủ nứt' }, true);
  assert.equal(ck.status, 201);
  assert.equal(ck.data.last_check_result, 'damaged');
  assert.equal(ck.data.condition, 'broken');
  const d = (await demo.get(`/assets/${a.id}`)).data;
  assert.equal(d.checks.length, 1);
  assert.equal(d.checks[0].has_photo, 1);
  assert.equal((await hr.get('/asset/market')).data.assets.find((x) => x.id === a.id).check_overdue, false);
  assert.equal((await other.get(`/assets/${a.id}`)).status, 403);

  // thanh lý NPP → thu hồi toàn bộ tài sản tại NPP
  assert.equal((await hr.post('/asset/market/recall-partner', { partner: 'NPP Hùng Vỹ Phúc' })).data.count, 1);
  const back = (await hr.get(`/assets/${a.id}`)).data;
  assert.equal(back.placement, 'company');
  assert.equal(back.holder_id, null);
  assert.ok(back.history.some((t) => t.type === 'place') && back.history.some((t) => t.type === 'recall'));
});

test('asset audit: open a round, confirm by QR link / code / own asset, close with the missing ones marked lost', async () => {
  const hr = await login('chilan');
  const demo = await login('demo');
  const mk = async (name) => (await hr.post('/assets', { name, type: 'Kệ, giá trưng bày', location: 'Kho Cần Thơ' })).data.items[0];
  const k1 = await mk('Kệ sắt 5 tầng A');
  const k2 = await mk('Kệ sắt 5 tầng B');
  const k3 = await mk('Kệ sắt 5 tầng C');
  await hr.post('/asset/handovers', { kind: 'issue', employee_id: demo.user.id, asset_ids: [k1.id] });

  assert.equal((await demo.post('/asset/audits', { name: 'Kiểm kê' })).status, 403);
  const op = await hr.post('/asset/audits', { name: 'Kiểm kê kho Cần Thơ Q4/2026', location: 'Kho Cần Thơ' });
  assert.equal(op.status, 201);
  assert.equal(op.data.total, 3);
  // tài sản đã nằm trong đợt đang mở thì không vào đợt khác
  assert.equal((await hr.post('/asset/audits', { name: 'Trùng', location: 'Kho Cần Thơ' })).status, 400);
  assert.equal((await hr.get(`/assets/${k2.id}`)).data.open_audits[0].id, op.data.id);
  assert.equal((await demo.get(`/asset/people/${demo.user.id}`)).data.audits[0].pending, 1);

  // nhân viên tự xác nhận tài sản đang giữ (quét QR = đường dẫn trang tài sản); không xác nhận được tài sản của người khác
  const url = `https://home.ldlvn.xyz/asset/item/${k1.id}`;
  assert.equal((await demo.post(`/asset/audits/${op.data.id}/scan`, { code: url, condition: 'fair' })).status, 200);
  assert.equal((await demo.post(`/asset/audits/${op.data.id}/scan`, { asset_id: k2.id })).status, 403);
  // quản lý nhập mã (máy quét mã vạch / gõ tay), ghi nhận sai vị trí
  const sc = await hr.post(`/asset/audits/${op.data.id}/scan`, { code: k2.code.toLowerCase(), actual_place: 'Kho Vĩnh Long' });
  assert.equal(sc.data.asset_id, k2.id);
  const d = (await hr.get(`/asset/audits/${op.data.id}`)).data;
  assert.equal(d.lines.filter((l) => l.found).length, 2);
  assert.equal((await hr.get(`/assets/${k1.id}`)).data.condition, 'fair');
  // nhân viên chỉ thấy dòng của mình
  assert.equal((await demo.get(`/asset/audits/${op.data.id}`)).data.lines.length, 1);

  const cl = await hr.post(`/asset/audits/${op.data.id}/close`, { mark_missing_lost: true });
  assert.equal(cl.data.missing, 1);
  assert.equal((await hr.get(`/assets/${k3.id}`)).data.status, 'lost');
  assert.equal((await hr.post(`/asset/audits/${op.data.id}/scan`, { asset_id: k3.id })).status, 400);
  const list = (await hr.get('/asset/audits')).data.find((x) => x.id === op.data.id);
  assert.equal(list.status, 'closed');
  assert.equal(list.moved, 1);
});

test('asset finance: created from an approved request, monthly depreciation, disposal with book value', async () => {
  const hr = await login('chilan');
  const demo = await login('demo');
  const a = (await hr.post('/assets', { name: 'Máy tính bảng DMS', type: 'Điện thoại', price: 12000000, purchase_date: '2026-01-15', depreciation_months: 12, request_id: 9001 })).data.items[0];
  const linked = (await hr.get('/asset/by-request/9001')).data;
  assert.equal(linked.assets[0].id, a.id);
  assert.match((await hr.get(`/assets/${a.id}`)).data.history[0].detail, /đề xuất #9001/);
  assert.equal((await demo.get('/asset/depreciation')).status, 403);

  // tháng 4/2026: đã dùng 3 tháng → luỹ kế 3 triệu, trong tháng 1 triệu, còn 9 triệu
  const dep = (await hr.get('/asset/depreciation?month=2026-04')).data;
  const row = dep.rows.find((x) => x.id === a.id);
  assert.deepEqual([row.months_used, row.in_month, row.accumulated, row.book_value], [3, 1000000, 3000000, 9000000]);
  assert.ok(dep.by_type.some((t) => t.type === 'Điện thoại' && t.in_month >= 1000000));
  // trước tháng mua: chưa có trong bảng
  assert.equal((await hr.get('/asset/depreciation?month=2025-12')).data.rows.some((x) => x.id === a.id), false);

  // đang có người giữ → không thanh lý được
  await hr.post('/asset/handovers', { kind: 'issue', employee_id: demo.user.id, asset_ids: [a.id] });
  assert.equal((await hr.post(`/assets/${a.id}/dispose`, { method: 'sell' })).status, 400);
  await hr.post('/asset/handovers', { kind: 'return', employee_id: demo.user.id, asset_ids: [a.id] });
  const dz = await hr.post(`/assets/${a.id}/dispose`, { method: 'sell', date: '2026-07-10', proceeds: '2.000.000', request_id: 9002 });
  assert.equal(dz.status, 200);
  assert.equal(dz.data.status, 'disposed');
  const list = (await hr.get('/asset/disposals?year=2026')).data.rows.find((x) => x.asset_id === a.id);
  assert.deepEqual([list.proceeds, list.book_value, list.cost], [2000000, 6000000, 12000000]);
  assert.equal((await hr.get('/asset/by-request/9002')).data.disposals.length, 1);
  // thanh lý tháng 7 → tháng 7 còn trong bảng, tháng 8 thì không
  assert.ok((await hr.get('/asset/depreciation?month=2026-07')).data.rows.some((x) => x.id === a.id));
  assert.equal((await hr.get('/asset/depreciation?month=2026-08')).data.rows.some((x) => x.id === a.id), false);
});

test('leave: half a day counts 0.5 and excuses the morning / afternoon; approved late-arrival / early-leave requests excuse the timesheet', async () => {
  const { run } = await import('../src/db.js');
  const admin = await login('admin');
  const pl = await login('phuonglinh');
  const kd = await login('truongkd');
  const tPl = await tokenOf('phuonglinh');
  const kdId = (await pl.get('/users')).data.find((u) => u.username === 'truongkd').id;
  const s0 = (await pl.get('/timeoff/summary')).data;
  // thêm trường "Buổi nghỉ" vào nhóm nghỉ phép
  const g = (await admin.get(`/request-groups/${s0.group_id}`)).data;
  const fields = [...g.fields.filter((f) => f.key !== 'session'), { key: 'session', label: 'Buổi nghỉ', type: 'select', options: ['Cả ngày', 'Buổi sáng', 'Buổi chiều'] }];
  assert.equal((await admin.put(`/request-groups/${g.id}`, { ...g, fields, approvers: g.approvers.map((a) => a.user_id), followers: g.followers.map((f) => f.user_id) })).status, 200);
  // nhóm đi muộn / về sớm (tự nhận theo tên)
  const eg = (await admin.post('/request-groups', { name: 'Đề xuất đi muộn / về sớm', category: 'Hành chính - Nhân sự', flow: 'sequential', custom_approvers: true,
    fields: [{ key: 'date', label: 'Ngày', type: 'date', required: true }, { key: 'kind', label: 'Loại', type: 'select', options: ['Về sớm', 'Đi muộn', 'Ra ngoài giữa giờ'], required: true },
      { key: 'time_from', label: 'Từ giờ', type: 'time' }, { key: 'time_to', label: 'Đến giờ', type: 'time' }, { key: 'reason', label: 'Lý do', type: 'textarea', required: true }] })).data.id;
  const submit = async (group, data) => (await upload(tPl, '/requests', { group_id: group, data: JSON.stringify(data), approvers: kdId }, false));
  assert.equal((await submit(eg, { date: '2026-12-04', kind: 'Đi muộn', time_from: '25:00', reason: 'x' })).status, 400);

  const half = (await submit(s0.group_id, { from: '2026-12-03', to: '2026-12-03', kind: 'Nghỉ phép năm', session: 'Buổi chiều', reason: 'Khám bệnh' })).data;
  const late = (await submit(eg, { date: '2026-12-04', kind: 'Đi muộn', time_from: '08:30', time_to: '10:00', reason: 'Gặp NPP' })).data;
  await kd.post(`/requests/${half.id}/decide`, { action: 'approve' });
  await kd.post(`/requests/${late.id}/decide`, { action: 'approve' });
  const s1 = (await pl.get('/timeoff/summary')).data;
  assert.equal(s1.used, s0.used + 0.5);

  // chấm công: 03/12 về lúc 15:00 (nghỉ chiều) — 04/12 vào lúc 10:00 (đi muộn có duyệt) — 07/12 về 16:00 (không đề xuất)
  for (const [date, inAt, outAt] of [['2026-12-03', '01:25', '08:00'], ['2026-12-04', '03:00', '10:40'], ['2026-12-07', '01:25', '09:00']]) {
    await run('INSERT INTO checkins(user_id, date, check_in_at, check_out_at) VALUES (?,?,?,?)', pl.user.id, date, `${date} ${inAt}:00`, `${date} ${outAt}:00`);
  }
  const m = (await pl.get('/checkin/month?month=2026-12')).data;
  const day = (d) => m.days.find((x) => x.date === d);
  assert.equal(day('2026-12-03').record.early_minutes, 0);
  assert.ok(day('2026-12-03').record.excused_early > 0);
  assert.equal(day('2026-12-03').leave.session, 'pm');
  assert.equal(day('2026-12-04').record.late_minutes, 0);
  assert.match(day('2026-12-04').record.excuse, /Đi muộn 08:30–10:00/);
  assert.equal(day('2026-12-04').status, 'ok');
  assert.ok(day('2026-12-07').record.early_minutes > 0);
  assert.equal(m.summary.leave, 0.5);
});
