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
