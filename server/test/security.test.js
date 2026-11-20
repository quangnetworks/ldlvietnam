import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ldl-sec-'));
process.env.JWT_SECRET = 'test-secret';
const { initNode } = await import('../src/node.js');
const { createApp } = await import('../src/app.js');
const { run } = await import('../src/db.js');

let app;
const base = 'http://test.local/api';
before(async () => {
  await initNode({ dataDir: tmp, reset: true });
  app = createApp();
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const attempt = (username, password, ip = '203.0.113.7') => app.fetch(new Request(`${base}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, 'X-Forwarded-For': ip },
  body: JSON.stringify({ username, password }),
}));

test('login: 5 wrong passwords lock the account for 15 minutes, even with the right password or another letter case', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await attempt(i % 2 ? 'DEMO' : 'demo', 'sai-mat-khau')).status, 401);
  const blocked = await attempt('demo', '123456');
  assert.equal(blocked.status, 429);
  assert.match((await blocked.json()).error, /15 phút/);
  // other accounts are not affected
  assert.equal((await attempt('admin', '123456', '198.51.100.1')).status, 200);
  // failures older than the window no longer count
  await run("UPDATE login_logs SET created_at = datetime('now', '-16 minutes') WHERE username = 'demo'");
  assert.equal((await attempt('demo', '123456')).status, 200);
});

test('login: one address guessing many accounts is stopped after 30 failures', async () => {
  const ip = '192.0.2.50';
  for (let i = 0; i < 30; i++) await attempt(`khong-ton-tai-${i}`, 'x', ip);
  assert.equal((await attempt('admin', '123456', ip)).status, 429);
  assert.equal((await attempt('admin', '123456', '192.0.2.51')).status, 200);
});

test('security headers on API and pages', async () => {
  const r = await app.fetch(new Request(`${base}/health`));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(r.headers.get('referrer-policy') || '', /strict-origin/);
  const h = await r.json();
  assert.equal(h.ok, true);
  assert.equal(h.db, true);
});
