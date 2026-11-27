import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { api, VIEWER } from './helpers';
import { assignDrawTimes } from '../../src/worker/services/sync';
import type { RawDraw } from '../../src/worker/services/importer';

const LOTTO = ['13:00', '21:00'];
const raw = (code: string, date: string): RawDraw => ({ draw_code: code, draw_date: date, draw_time: null, main: [1, 2, 3, 4, 5], special: 1 });
async function addVerifiedDraw(code: string, date: string, time: string | null, main: number[], special: number): Promise<number> {
  const add = await api('/admin/draws', { body: { game: 'lotto535', draw_code: code, draw_date: date, draw_time: time, main, special } });
  if (add.status !== 201) throw new Error(JSON.stringify(add.body));
  const id = (await env.DB.prepare('SELECT id FROM draws WHERE draw_code = ?').bind(code).first<{ id: number }>())!.id;
  const v = await api(`/admin/draws/${id}/verify`, { body: { status: 'verified', note: 'Đối chiếu kết quả chính thức' } });
  if (v.status !== 200) throw new Error(JSON.stringify(v.body));
  return id;
}
const future = (days: number) => new Date(Date.now() + 7 * 3600e3 + days * 864e5).toISOString().slice(0, 10);

describe('Gán giờ quay khi ngày chưa đủ kỳ', () => {
  it('Kỳ đầu tiên sau kỳ 21:00 hôm trước là kỳ 13:00 (đồng bộ lúc 15:00)', () => {
    const rows = [raw('01029', '2026-11-25'), raw('01030', '2026-11-25'), raw('01031', '2026-11-26')];
    assignDrawTimes(rows, LOTTO);
    expect(rows.map((r) => r.draw_time)).toEqual(['13:00', '21:00', '13:00']);
  });
  it('Nguồn thiếu kỳ 13:00 ⇒ kỳ duy nhất trong ngày là 21:00', () => {
    const rows = [raw('00010', '2026-01-01'), raw('00011', '2026-01-01'), raw('00013', '2026-01-02')];
    assignDrawTimes(rows, LOTTO);
    expect(rows[2].draw_time).toBe('21:00');
  });
  it('Không suy ra được (ngày trước cũng thiếu, mã không liên tiếp) ⇒ để trống, không đoán', () => {
    const rows = [raw('00010', '2026-01-01'), raw('00020', '2026-01-02')];
    assignDrawTimes(rows, LOTTO);
    expect(rows.map((r) => r.draw_time)).toEqual([null, null]);
  });
});

describe('Điền giờ quay còn trống', () => {
  it('Điền được cả kỳ đã xác minh; không đổi giờ đã có; giờ phải thuộc lịch quay', async () => {
    const id = await addVerifiedDraw('90001', '2026-11-26', null, [3, 9, 14, 22, 31], 7);
    expect((await api(`/admin/draws/${id}/time`, { body: { draw_time: '15:00' } })).status).toBe(422);
    expect((await api(`/admin/draws/${id}/time`, { body: { draw_time: '13:00' }, token: VIEWER })).status).toBe(403);
    const ok = await api(`/admin/draws/${id}/time`, { body: { draw_time: '13:00' } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.drawTime).toBe('13:00');
    expect(ok.body.data.verificationStatus).toBe('verified');
    expect((await api(`/admin/draws/${id}/time`, { body: { draw_time: '21:00' } })).status).toBe(409);
    // Trigger vẫn chặn đổi giờ đã có của kỳ đã xác minh.
    await expect(env.DB.prepare("UPDATE draws SET draw_time = '21:00' WHERE id = ?").bind(id).run()).rejects.toThrow(/immutable/);
    await expect(env.DB.prepare("UPDATE draws SET special_number = 9 WHERE id = ?").bind(id).run()).rejects.toThrow(/immutable/);
  });
});

describe('Danh mục nhập tay', () => {
  const tickets = [
    { main: [26, 2, 5, 8, 23], special: 8 },
    { main: [6, 10, 26, 29, 35], special: 5 },
  ];

  it('Tạo danh mục thực tế cho kỳ đã quay (vé đã mua thật), có đánh dấu; chấm được với kỳ đã xác minh', async () => {
    await addVerifiedDraw('90010', '2026-11-20', '13:00', [10, 21, 24, 30, 32], 8);
    const r = await api('/portfolios/manual', { body: { game: 'lotto535', name: 'Vé sáng 20/11', mode: 'real', target_draw_date: '2026-11-20', target_draw_time: '13:00', tickets } });
    expect(r.status).toBe(201);
    expect(r.body.data.enteredAfterDraw).toBe(true);
    const id = r.body.data.id;
    const p = await api(`/portfolios/${id}`);
    expect(p.body.data.ticket_count).toBe(2);
    expect(p.body.data.total_cost).toBe(20000);
    expect(p.body.data.notes).toMatch(/Nhập sau giờ quay/);
    expect(p.body.data.tickets[0].main).toEqual([2, 5, 8, 23, 26]);
    expect((await api(`/portfolios/${id}/purchase`, { body: { purchase_date: '2026-11-20' } })).status).toBe(200);
    const ev = await api(`/portfolios/${id}/evaluate`, { body: {} });
    expect(ev.body.data.evaluated).toBe(true);
    const after = await api(`/portfolios/${id}`);
    expect(after.body.data.tickets[0].result.prizeTier).toBe('consolation_0'); // 0 số + ĐB 08 ⇒ khuyến khích
  });

  it('Kiểm tra: mô phỏng không nhắm kỳ đã quay; Lotto phải chọn giờ; vé sai thể lệ; người xem không tạo được', async () => {
    expect((await api('/portfolios/manual', { body: { game: 'lotto535', name: 'x', mode: 'simulated', target_draw_date: '2026-11-20', target_draw_time: '13:00', tickets } })).status).toBe(422);
    expect((await api('/portfolios/manual', { body: { game: 'lotto535', name: 'x', mode: 'simulated', target_draw_date: future(3), tickets } })).status).toBe(422);
    const bad = await api('/portfolios/manual', { body: { game: 'lotto535', name: 'x', mode: 'simulated', target_draw_date: future(3), target_draw_time: '21:00', tickets: [{ main: [1, 2, 3, 4, 36], special: 13 }] } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.length).toBeGreaterThanOrEqual(2);
    expect((await api('/portfolios/manual', { body: { game: 'lotto535', name: 'x', mode: 'real', target_draw_date: future(3), target_draw_time: '21:00', tickets }, token: VIEWER })).status).toBe(403);
  });

  it('Sửa danh mục: nháp sửa được vé; đã mua chỉ sửa giờ/ngày; đã chấm không sửa được', async () => {
    const r = await api('/portfolios/manual', { body: { game: 'lotto535', name: 'Nháp', mode: 'real', target_draw_date: future(2), target_draw_time: '13:00', tickets } });
    const id = r.body.data.id;
    const upd = await api(`/portfolios/${id}`, { method: 'PUT', body: { name: 'Nháp đã sửa', target_draw_time: '21:00', tickets: [...tickets, { main: [1, 7, 13, 19, 33], special: 12 }] } });
    expect(upd.status).toBe(200);
    expect(upd.body.data.name).toBe('Nháp đã sửa');
    expect(upd.body.data.target_draw_time).toBe('21:00');
    expect(upd.body.data.ticket_count).toBe(3);
    expect(upd.body.data.total_cost).toBe(30000);
    expect(upd.body.data.tickets).toHaveLength(3);
    expect((await api(`/portfolios/${id}`, { method: 'PUT', body: { target_draw_time: '18:00' } })).status).toBe(422);
    expect((await api(`/portfolios/${id}/purchase`, { body: {} })).status).toBe(200);
    expect((await api(`/portfolios/${id}`, { method: 'PUT', body: { tickets } })).status).toBe(409);
    const t = await api(`/portfolios/${id}`, { method: 'PUT', body: { target_draw_time: '13:00' } });
    expect(t.status).toBe(200);
    expect(t.body.data.target_draw_time).toBe('13:00');
    const audit = await api('/audit?action=portfolios.');
    expect(audit.body.data.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['portfolios.create_manual', 'portfolios.update']));
  });
});
