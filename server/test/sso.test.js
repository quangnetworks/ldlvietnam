import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verify } from 'hono/jwt';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ldl-sso-'));
process.env.JWT_SECRET = 'test-secret';
process.env.NPP_SSO_SECRET = 'npp-sso-test-secret';
process.env.NPP_URL = 'https://npp.example.test/';
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

const STATE = 'AbCdEfGhIjKlMnOpQrSt_-12';

test('NPP Control Tower is opt-in: members do not get it by default', async () => {
  const demo = await login('demo');
  assert.ok(!(await demo.get('/auth/me')).data.apps.includes('npp'));
  assert.equal((await demo.post('/sso/npp', { state: STATE })).status, 403);
});

test('a granted account gets a short, single-purpose ticket bound to the state', async () => {
  const admin = await login('admin');
  const demo = await login('demo');
  assert.equal((await admin.put('/account/apps/npp', { users: [demo.user.id] })).status, 200);
  const r = await demo.post('/sso/npp', { state: STATE });
  assert.equal(r.status, 200);
  const url = new URL(r.data.url);
  assert.equal(url.origin + url.pathname, 'https://npp.example.test/api/auth/workspace/callback');
  assert.equal(url.searchParams.get('state'), STATE);
  const p = await verify(url.searchParams.get('ticket'), 'npp-sso-test-secret', 'HS256');
  assert.equal(p.sub, String(demo.user.id));
  assert.equal(p.aud, 'npp-control-tower');
  assert.equal(p.iss, 'ldl-workspace');
  assert.equal(p.state, STATE);
  assert.ok(p.exp - p.iat <= 60);
  assert.ok(p.jti && p.jti.length >= 16);
  // nothing personal in the ticket
  assert.deepEqual(Object.keys(p).sort(), ['aud', 'exp', 'iat', 'iss', 'jti', 'state', 'sub']);
});

test('started from the app tile (no state) → NPP creates the state first; bad state rejected', async () => {
  const admin = await login('admin');
  const r = await admin.post('/sso/npp', {});
  assert.equal(r.status, 200);
  assert.equal(r.data.url, 'https://npp.example.test/api/auth/workspace/start');
  assert.equal((await admin.post('/sso/npp', { state: 'x"><script>' })).status, 400);
});

test('not signed in → 401', async () => {
  const r = await app.fetch(new Request(`${base}/sso/npp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: STATE }) }));
  assert.equal(r.status, 401);
});
