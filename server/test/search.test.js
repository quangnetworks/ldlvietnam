import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ldl-search-'));
process.env.JWT_SECRET = 'test-secret';
const { initNode } = await import('../src/node.js');
const { createApp } = await import('../src/app.js');
const { fold, ftsQuery } = await import('../src/search.js');

let app;
const base = 'http://test.local/api';
before(async () => { await initNode({ dataDir: tmp, reset: true }); app = createApp(); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function login(username) {
  const res = await app.fetch(new Request(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: '123456' }) }));
  const { token, user } = await res.json();
  const call = async (method, url, body) => {
    const opts = { method, headers: { Authorization: `Bearer ${token}` } };
    if (body instanceof FormData) opts.body = body;
    else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const r = await app.fetch(new Request(base + url, opts));
    return { status: r.status, data: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() };
  };
  return { user, get: (u) => call('GET', u), post: (u, b) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u) };
}
const titles = (res) => (res.data.items || res.data).map((x) => x.title ?? x.name);
const q = (s) => encodeURIComponent(s);

test('fold / query: bỏ dấu, đ→d, chữ thường, bỏ HTML, tách chữ-số', () => {
  assert.equal(fold('<p>QUYẾT ĐỊNH <b>số</b> 12/QĐ-LDL&nbsp;năm 2026</p>'), 'quyet dinh so 12/qd-ldl nam 2026');
  assert.equal(fold('LDL0123'), 'ldl 0123');
  assert.equal(ftsQuery('  Bổ nhiệm, kinh-doanh '), '"bo"* "nhiem"* "kinh"* "doanh"*');
  assert.equal(ftsQuery('!!! ---'), null);
});

test('Office: không dấu, hoa thường, mọi thứ tự từ, nội dung không tính thẻ HTML, xếp theo liên quan, đúng quyền', async () => {
  const hr = await login('chilan');
  const demo = await login('demo');
  const mkt = await login('duylinh');
  const mk = async (title, content, deps) => {
    const fd = new FormData();
    fd.append('title', title);
    fd.append('content', content);
    if (deps) fd.append('recipient_departments', String(deps));
    return (await hr.post('/documents', fd)).data;
  };
  const a = await mk('Quyết định bổ nhiệm Trưởng phòng Kinh doanh', '<p class="lead">Căn cứ <b>Điều lệ</b> công ty</p>', demo.user.department_id);
  const b = await mk('Điều lệ công ty sửa đổi năm 2026', '<p>Toàn văn</p>');
  for (const s of ['quyet dinh bo nhiem', 'QUYẾT ĐỊNH', 'kinh doanh bổ nhiệm', 'Quyết đ', 'truong phong']) {
    assert.ok(titles(await demo.get(`/documents?q=${q(s)}`)).includes(a.title), `không tìm thấy với "${s}"`);
  }
  assert.ok(!titles(await demo.get(`/documents?q=${q('lead')}`)).includes(a.title), 'không khớp thuộc tính HTML');
  // "điều lệ": văn bản có trong tiêu đề xếp trước văn bản chỉ có trong nội dung
  const ranked = titles(await demo.get(`/documents?q=${q('dieu le')}`));
  assert.deepEqual(ranked.filter((t) => t === a.title || t === b.title), [b.title, a.title]);
  // Người ngoài phòng nhận không tìm thấy văn bản gửi riêng phòng Kinh doanh
  assert.ok(!titles(await mkt.get(`/documents?q=${q('bo nhiem truong phong')}`)).includes(a.title));
});

test('Wework: chỉ mục cập nhật khi sửa / xoá; tìm theo mã #id; tìm nhanh', async () => {
  const kd = await login('truongkd');
  const { data: t } = await kd.post('/tasks', { title: 'Chuẩn bị hồ sơ dự thầu Đà Nẵng', description: 'Liên hệ nhà cung cấp thiết bị' });
  assert.ok(titles(await kd.get(`/tasks?q=${q('ho so thau da nang')}`)).includes(t.title));
  assert.ok(titles(await kd.get(`/tasks?q=${q('nha cung cap')}`)).includes(t.title)); // mô tả
  assert.ok(titles(await kd.get(`/tasks?q=${q(`#${t.id}`)}`)).includes(t.title));
  await kd.put(`/tasks/${t.id}`, { title: 'Nộp báo giá gói thầu' });
  assert.ok(!titles(await kd.get(`/tasks?q=${q('ho so du thau')}`)).includes(t.title));
  assert.ok(titles(await kd.get(`/tasks?q=${q('nop bao gia')}`)).includes('Nộp báo giá gói thầu'));
  const quick = await kd.get(`/search?q=${q('bao gia goi thau')}`);
  assert.ok(quick.data.tasks.some((x) => x.id === t.id));
  await kd.del(`/tasks/${t.id}`);
  assert.ok(!titles(await kd.get(`/tasks?q=${q('nop bao gia')}`)).includes('Nộp báo giá gói thầu'));
});

test('Nhân sự, thành viên, tin nhắn, đề xuất', async () => {
  const hr = await login('chilan');
  const demo = await login('demo');
  const mkt = await login('duylinh');
  // nhân viên theo tên không dấu và mã nhân viên (LDL006 = demo)
  const emp = (await hr.get(`/hrm/employees?view=all&q=${q('LDL006')}`)).data;
  assert.ok((emp.items || emp).some((u) => u.id === demo.user.id));
  const users = (await demo.get(`/users?q=${q('nguyen phuong')}`)).data;
  assert.ok(users.some((u) => u.username === 'phuonglinh'));
  // tin nhắn
  const dm = (await demo.post('/chat/direct', { user_id: mkt.user.id })).data;
  await demo.post(`/chat/channels/${dm.id}/messages`, { content: 'Họp giao ban lúc 9 giờ sáng thứ Hai' });
  assert.ok((await mkt.get(`/chat/search?q=${q('giao ban thu hai')}`)).data.some((m) => m.content.includes('giao ban')));
  const hrMsgs = (await hr.get(`/chat/search?q=${q('giao ban thu hai')}`)).data;
  assert.ok(!hrMsgs.some((m) => m.content.includes('Họp giao ban lúc 9')), 'không thấy tin nhắn riêng của người khác');
  // đề xuất theo mã #id
  const list = (await demo.get('/requests')).data.items;
  if (list.length) {
    const r0 = list[0];
    assert.ok((await demo.get(`/requests?q=${q(`#${r0.id}`)}`)).data.items.some((x) => x.id === r0.id));
  }
});
