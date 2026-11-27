import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { parseOpenDataJsonl, syncAll } from '../../src/worker/services/sync';
import { api } from './helpers';
import { LOTTO535, POWER655 } from '../fixtures';

const actor = { db: env.DB, actorId: 'system:test', actorRole: 'system', requestId: null, ip: null };

// Dữ liệu mẫu ĐỊNH DẠNG giống nguồn mở (chỉ dùng trong test).
const power = [
  '{"date":"2023-10-10","id":"00942","result":[1,2,3,4,5,6,7]}',
  '{"date":"2023-10-12","id":"00943","result":[10,20,30,40,50,55,9]}',
  '{"date":"2022-09-23","id":"00944","result":[1,12,21,28,30,44]}', // thiếu số đặc biệt (lỗi thật ở nguồn)
  'không phải json',
].join('\n');
const lotto = [
  '{"date":"2025-06-29","id":"00001","result":[7,9,10,16,19,9]}',
  '{"date":"2025-06-29","id":"00002","result":[6,12,14,18,25,8]}',
  '{"date":"2025-06-30","id":"00003","result":[1,2,3,4,36,1]}', // ngoài miền
].join('\n');

const fetcher = async (url: string) => new Response(url.includes('power655') ? power : lotto, { status: 200 });

describe('Parser nguồn dữ liệu mở', () => {
  it('Tách số chính / số đặc biệt, gán giờ quay theo lịch, báo dòng hỏng', () => {
    const p = parseOpenDataJsonl(lotto, LOTTO535, ['13:00', '21:00']);
    expect(p.rows[0]).toMatchObject({ draw_code: '00001', main: [7, 9, 10, 16, 19], special: 9, draw_time: '13:00' });
    expect(p.rows[1].draw_time).toBe('21:00');
    // Ngày mới có 1 kỳ (đồng bộ trước kỳ 21:00): mã 00003 liền sau kỳ 21:00 hôm trước ⇒ là kỳ 13:00 (suy ra, không đoán).
    expect(p.rows[2].draw_time).toBe('13:00');
    const q = parseOpenDataJsonl(power, POWER655, ['18:00']);
    expect(q.rows.map((r) => r.draw_code)).toEqual(['00942', '00943']);
    expect(q.errors.map((e) => e.code)).toEqual(['shape', 'parse_error']);
  });
});

describe('Đồng bộ tự động', () => {
  it('Nhập dữ liệu mới ở trạng thái chưa xác minh, idempotent, không báo lỗi lặp lại', async () => {
    const r1 = await syncAll(actor, { fetcher });
    const p1 = r1.results.find((r) => r.game === 'power655')!;
    expect(p1.import).toMatchObject({ inserted: 2, invalid: 2 });
    const l1 = r1.results.find((r) => r.game === 'lotto535')!;
    expect(l1.import).toMatchObject({ inserted: 2, invalid: 1 });
    const d = await api('/draws?game=lotto535&status=unverified');
    expect(d.body.data.map((x: any) => [x.drawCode, x.drawTime, x.sourceName])).toEqual([
      ['00002', '21:00', 'vietlott-data (GitHub, MIT)'],
      ['00001', '13:00', 'vietlott-data (GitHub, MIT)'],
    ]);
    // Lần 2: không có gì mới ⇒ không tạo import job mới
    const jobsBefore = (await env.DB.prepare('SELECT COUNT(*) AS n FROM import_jobs').first<{ n: number }>())!.n;
    const r2 = await syncAll(actor, { fetcher });
    expect(r2.results.every((r) => r.import === null)).toBe(true);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM import_jobs').first<{ n: number }>())!.n).toBe(jobsBefore);
    // Audit
    expect((await api('/audit?action=draws.sync')).body.data.length).toBe(2);
  });

  it('Tắt auto sync ⇒ cron không chạy (trừ khi quản trị viên chủ động)', async () => {
    await api('/admin/settings', { method: 'PUT', body: { auto_sync_enabled: false } });
    expect((await syncAll(actor, { fetcher })).results).toEqual([]);
    expect((await syncAll(actor, { fetcher, force: true })).enabled).toBe(false);
  });

  it('Trạng thái đồng bộ & xác minh toàn bộ một lần nhập (cần lý do, có audit)', async () => {
    await syncAll(actor, { fetcher, force: true, games: ['power655'] });
    const st = await api('/sync/status');
    expect(st.status).toBe(200);
    expect(st.body.data.officialSourceNote).toContain('chống bot');
    const job = st.body.data.jobs.find((j: any) => j.game_code === 'power655' && j.unverified > 0);
    expect((await api(`/admin/import-jobs/${job.id}/verify`, { body: { note: 'ngắn' } })).status).toBe(400);
    const v = await api(`/admin/import-jobs/${job.id}/verify`, { body: { note: 'Đã đối chiếu với bảng kết quả chính thức' } });
    expect(v.body.data.verified).toBe(job.unverified);
    expect((await api('/audit?action=draws.verify_import_job')).body.data.length).toBe(1);
    expect((await api('/admin/sync', { token: 'test-viewer-token-0123456789', body: {} })).status).toBe(403);
  });
});

describe('Quyết định hôm nay (API)', () => {
  it('Tính quyết định, cập nhật Jackpot có kiểm tra & audit, ghi nhận lần chạy', async () => {
    const g = await api('/decision/today?now=2026-11-21T01:00:00Z');
    expect(g.status).toBe(200);
    expect(g.body.data.decision.candidates.length).toBe(3);
    expect((await api('/admin/jackpots', { method: 'PUT', body: { game: 'power655', values: { jackpot1: 1000 } } })).status).toBe(400);
    expect((await api('/admin/jackpots', { method: 'PUT', body: { game: 'power655', values: { first: 50000000 } } })).status).toBe(400);
    const u = await api('/admin/jackpots', { method: 'PUT', body: { game: 'power655', values: { jackpot1: 250_000_000_000, jackpot2: 5_000_000_000 } } });
    expect(u.status).toBe(200);
    const g2 = await api('/decision/today?now=2026-11-21T01:00:00Z');
    expect(g2.body.data.decision.candidates[0].game).toBe('power655');
    expect(g2.body.data.decision.candidates[0].jackpotIsMinimum).toBe(false);
    const p = await api('/decision/today?now=2026-11-21T01:00:00Z', { body: {} });
    expect(p.status).toBe(201);
    expect(p.body.data.modelRunId).toBeGreaterThan(0);
    expect((await api('/audit?action=jackpots.update')).body.data.length).toBe(1);
    expect((await api('/admin/jackpots', { method: 'PUT', token: 'test-viewer-token-0123456789', body: { game: 'power655', values: {} } })).status).toBe(403);
  });
});
