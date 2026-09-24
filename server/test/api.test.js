import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ldl-test-'));
process.env.DATA_DIR = tmp;
process.env.JWT_SECRET = 'test-secret';

const { initNode } = await import('../src/node.js');
const { createApp } = await import('../src/app.js');

let app;
const base = 'http://test.local/api';
const fetch = (url, opts) => app.fetch(new Request(url, opts));
before(async () => {
  await initNode({ dataDir: tmp, reset: true });
  app = createApp();
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function login(username) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: '123456' }),
  });
  assert.equal(res.status, 200);
  const { token, user } = await res.json();
  const call = async (method, url, body) => {
    const opts = { method, headers: { Authorization: `Bearer ${token}` } };
    if (body instanceof FormData) opts.body = body;
    else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const r = await fetch(base + url, opts);
    const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
    return { status: r.status, data };
  };
  return { user, get: (u) => call('GET', u), post: (u, b) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u) };
}

test('rejects bad credentials and unauthenticated calls', async () => {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: 'x' }) });
  assert.equal(r.status, 401);
  assert.equal((await fetch(`${base}/documents`)).status, 401);
});

test('document approval workflow: submit -> approve step by step -> issued', async () => {
  const hr = await login('chilan');
  const admin = await login('admin');
  const gd = await login('giamdoc');
  const demo = await login('demo');

  const fd = new FormData();
  fd.append('title', 'Quy định làm việc từ xa');
  fd.append('kind', 'internal');
  fd.append('approvers', `${admin.user.id},${gd.user.id}`);
  fd.append('files', new Blob(['xin chao']), 'quy-định.txt');
  const created = await hr.post('/documents', fd);
  assert.equal(created.status, 201);
  const id = created.data.id;
  assert.equal(created.data.status, 'pending');
  assert.equal(created.data.attachments[0].original_name, 'quy-định.txt');

  // Not yet visible to regular staff
  assert.equal((await demo.get(`/documents/${id}`)).status, 403);
  // Second approver cannot act before the first
  assert.equal((await gd.post(`/documents/${id}/approve`, { decision: 'approve' })).status, 403);

  const pendingAdmin = await admin.get('/documents?box=pending_me');
  assert.ok(pendingAdmin.data.items.some((d) => d.id === id));

  let r = await admin.post(`/documents/${id}/approve`, { decision: 'approve' });
  assert.equal(r.data.status, 'pending');
  r = await gd.post(`/documents/${id}/approve`, { decision: 'approve', comment: 'OK' });
  assert.equal(r.data.status, 'issued');

  const seen = await demo.get(`/documents/${id}`);
  assert.equal(seen.status, 200);
  assert.equal(seen.data.view_count, 1);
  const att = await demo.get(`/documents/${id}/attachments/${seen.data.attachments[0].id}`);
  assert.equal(att.data, 'xin chao');

  const notes = await demo.get('/notifications');
  assert.ok(notes.data.items.some((n) => n.link === `/office/doc/${id}`));
});

test('rejected document can be edited and resubmitted', async () => {
  const hr = await login('chilan');
  const gd = await login('giamdoc');
  const fd = new FormData();
  fd.append('title', 'Đề xuất mua sắm');
  fd.append('approvers', String(gd.user.id));
  const { data: doc } = await hr.post('/documents', fd);
  const rej = await gd.post(`/documents/${doc.id}/approve`, { decision: 'reject', comment: 'Thiếu báo giá' });
  assert.equal(rej.data.status, 'rejected');
  const again = await hr.post(`/documents/${doc.id}/submit`);
  assert.equal(again.data.status, 'pending');
  assert.equal(again.data.approvers[0].status, 'pending');
});

test('document recipients restrict visibility', async () => {
  const hr = await login('chilan');
  const demo = await login('demo');
  const kd = await login('truongkd');
  const fd = new FormData();
  fd.append('title', 'Thông báo riêng phòng kinh doanh');
  fd.append('recipient_departments', String(kd.user.department_id));
  const { data: doc } = await hr.post('/documents', fd);
  assert.equal(doc.status, 'issued');
  assert.equal((await demo.get(`/documents/${doc.id}`)).status, 200); // demo thuộc phòng KD
  const mkt = await login('duylinh');
  assert.equal((await mkt.get(`/documents/${doc.id}`)).status, 403);
});

test('document list filters, export and trash', async () => {
  const hr = await login('chilan');
  const list = await hr.get('/documents?tab=incoming');
  assert.ok(list.data.items.every((d) => d.kind === 'incoming'));
  const csv = await hr.get('/documents/export');
  assert.match(csv.data, /Số hiệu/);
  const fd = new FormData();
  fd.append('title', 'Nháp sẽ xóa');
  fd.append('draft', '1');
  const { data: doc } = await hr.post('/documents', fd);
  assert.equal(doc.status, 'draft');
  await hr.del(`/documents/${doc.id}`);
  const trash = await hr.get('/documents?box=trash');
  assert.ok(trash.data.items.some((d) => d.id === doc.id));
});

test('tasks: create, permissions, recurring completion spawns next occurrence', async () => {
  const demo = await login('demo');
  const kd = await login('truongkd');
  const mkt = await login('duylinh');
  const { data: task } = await kd.post('/tasks', {
    title: 'Báo cáo tuần', assignee_id: demo.user.id, due_date: '2026-01-05', start_date: '2026-01-01', recurring: 'weekly',
  });
  assert.equal(task.assignee_id, demo.user.id);
  assert.equal((await mkt.get(`/tasks/${task.id}`)).status, 403);

  const done = await demo.put(`/tasks/${task.id}`, { status: 'done' });
  assert.equal(done.data.status, 'done');
  assert.equal(done.data.recurring, null);
  const rec = await demo.get('/tasks?scope=recurring&q=Báo cáo tuần');
  const next = rec.data.items.find((t) => t.id !== task.id);
  assert.equal(next.due_date, '2026-01-12');
  assert.equal(next.start_date, '2026-01-08');

  const bad = await demo.put(`/tasks/${next.id}`, { start_date: '2026-02-01' });
  assert.equal(bad.status, 400);
});

test('projects: create from template copies lists and tasks; non-members blocked', async () => {
  const demo = await login('demo');
  const mkt = await login('duylinh');
  const { data: templates } = await demo.get('/projects?template=1');
  assert.ok(templates.length >= 1);
  const { data: p } = await demo.post('/projects', { name: 'Ra mắt sản phẩm X', template_id: templates[0].id });
  assert.equal(p.lists.length, 3);
  const tasks = await demo.get(`/tasks?project_id=${p.id}`);
  assert.equal(tasks.data.total, 3);
  assert.equal((await mkt.get(`/projects/${p.id}`)).status, 403);
  assert.equal((await mkt.post('/tasks', { title: 'x', project_id: p.id })).status, 403);
  const r = await demo.put(`/projects/${p.id}/members`, { members: [{ user_id: mkt.user.id, role: 'member' }] });
  assert.equal(r.data.members.length, 2);
  assert.equal((await mkt.get(`/projects/${p.id}`)).status, 200);
});

test('reports and summary respond', async () => {
  const demo = await login('demo');
  const s = await demo.get('/wework/summary');
  assert.equal(typeof s.data.rate, 'number');
  // báo cáo chỉ dành cho quản trị viên và người được cấp quyền
  assert.equal((await demo.get('/wework/reports')).status, 403);
  const admin = await login('admin');
  const rep = await admin.get('/wework/reports');
  assert.ok(Array.isArray(rep.data.by_status));
});

test('admin-only endpoints are protected', async () => {
  const demo = await login('demo');
  assert.equal((await demo.post('/users', { username: 'x', password: '123456', name: 'X' })).status, 403);
  const admin = await login('admin');
  const u = await admin.post('/users', { username: 'newbie', password: '123456', name: 'Nhân viên mới' });
  assert.equal(u.status, 201);
  await login('newbie');
});

test('attachments: unicode names kept, unsafe types never rendered inline', async () => {
  const hr = await login('chilan');
  const fd = new FormData();
  fd.append('title', 'Có tệp đính kèm');
  fd.append('files', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'trang.html');
  fd.append('files', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'Biên bản.pdf');
  const { data: doc } = await hr.post('/documents', fd);
  const [html, pdf] = doc.attachments;
  assert.equal(pdf.original_name, 'Biên bản.pdf');
  const token = (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'chilan', password: '123456' }) })).json()).token;
  const res = await fetch(`${base}/documents/${doc.id}/attachments/${html.id}?inline=1`, { headers: { Authorization: `Bearer ${token}` } });
  assert.match(res.headers.get('content-disposition'), /^attachment/);
  assert.match(res.headers.get('content-security-policy'), /sandbox/);
  const res2 = await fetch(`${base}/documents/${doc.id}/attachments/${pdf.id}?inline=1`, { headers: { Authorization: `Bearer ${token}` } });
  assert.match(res2.headers.get('content-disposition'), /^inline/);
});
