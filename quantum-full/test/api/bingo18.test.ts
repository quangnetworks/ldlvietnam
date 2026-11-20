import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { syncBingo, parseBingoChunk } from '../../src/worker/services/bingoSync';
import { bingoDrawsRemaining } from '../../src/worker/routes/bingo18';
import { api } from './helpers';
import { createRng } from '../../src/engine/rng';

const actor = { db: env.DB, actorId: 'system:test', actorRole: 'system', requestId: null, ip: null };

// Tệp JSONL TỔNG HỢP cùng định dạng nguồn mở (chỉ dùng trong test).
function makeFile(n: number): Uint8Array {
  const rng = createRng('bingo-file');
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = [rng.int(1, 6), rng.int(1, 6), rng.int(1, 6)];
    const day = new Date(Date.UTC(2025, 0, 1) + Math.floor(i / 150) * 86400000).toISOString().slice(0, 10);
    lines.push(JSON.stringify({ date: day, id: String(100000 + i).padStart(7, '0'), result: r, total: r[0] + r[1] + r[2] }));
  }
  lines.splice(5, 0, '{"date":"2025-01-01","id":"0099999","result":[7,1,1],"total":9}'); // số ngoài miền
  return new TextEncoder().encode(lines.join('\n') + '\n');
}

function rangeFetcher(file: Uint8Array) {
  return async (_url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range') ?? '';
    let start = 0;
    let end = file.length - 1;
    const tail = /^bytes=-(\d+)$/.exec(range);
    const span = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (tail) return new Response('suffix range not supported', { status: 501 }); // mô phỏng proxy không hỗ trợ hậu tố
    else if (span) [start, end] = [Number(span[1]), Math.min(file.length - 1, Number(span[2]))];
    return new Response(file.slice(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${file.length}` } });
  };
}

describe('Bingo18 — đồng bộ theo HTTP Range', () => {
  it('Parse đoạn: bỏ dòng cắt dở đầu/cuối, báo dòng sai', () => {
    const f = new TextEncoder().encode('{"date":"2025-01-01","id":"1","result":[1,2,3],"total":6}\n{"date":"2025-01-01","id":"2","result":[1,1,1],"total":3}\n{"date":"2025');
    const c = parseBingoChunk(f.slice(10), 10, f.length);
    expect(c.rows.map((r) => r.code)).toEqual(['2']);
    expect(c.firstLineOffset).toBe(f.indexOf(10) + 1);
  });

  it('Tải đuôi + tải dần lịch sử tới hết tệp, không trùng, kỳ lỗi bị loại; chạy lại không tạo dữ liệu thừa', async () => {
    const file = makeFile(30000); // ~2MB
    const fetcher = rangeFetcher(file);
    let r = await syncBingo(actor, fetcher);
    expect(r.error).toBeNull();
    expect(r.tail.inserted).toBeGreaterThan(500);
    let guard = 0;
    while (!r.backfill.done && guard++ < 20) r = await syncBingo(actor, fetcher);
    expect(r.backfill.done).toBe(true);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n, MIN(draw_code) AS lo, MAX(draw_code) AS hi FROM bingo18_draws').first<{ n: number; lo: string; hi: string }>();
    expect(n).toEqual({ n: 30000, lo: '0100000', hi: '0129999' });
    const again = await syncBingo(actor, fetcher);
    expect(again.tail.inserted).toBe(0);
    expect(again.tail.jobId).toBeNull();
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM bingo18_draws').first<{ n: number }>())!.n).toBe(30000);
    // Bất biến sau xác minh
    await env.DB.prepare("UPDATE bingo18_draws SET verification_status = 'verified' WHERE draw_code = '0100001'").run();
    await expect(env.DB.prepare("UPDATE bingo18_draws SET d1 = 1 WHERE draw_code = '0100001'").run()).rejects.toThrow(/verified_draw_immutable/);
  });

  it('API: bảng cược, kết quả, thống kê, mô phỏng, quyết định, ghi nhận chi tiêu có hạn mức', async () => {
    const rules = await api('/bingo18/rules');
    expect(rules.body.data.bestReturn.bet.type).toBe('single');
    expect(rules.body.data.catalog.length).toBe(23);
    const draws = await api('/bingo18/draws?page_size=5');
    expect(draws.body.meta.total).toBe(30000);
    const jobs = (await api('/sync/status')).body.data.jobs.filter((j: any) => j.game_code === 'bingo18');
    for (const j of jobs) if (j.unverified) await api(`/admin/import-jobs/${j.id}/verify`, { body: { note: 'Kiểm thử xác minh dữ liệu Bingo18' } });
    const st = await api('/bingo18/statistics?last=20000');
    expect(st.body.data.draws).toBe(20000);
    expect(st.body.data.facesChiSquare.pValue).toBeGreaterThan(0.001);
    const sim = await api('/bingo18/simulate', { body: { bets: [{ bet: { type: 'big' }, stakeUnits: 2 }], drawsPerSession: 30, sessions: 500, seed: 'x' } });
    expect(sim.status).toBe(201);
    expect(sim.body.data.costPerDraw).toBe(20000);
    expect((await api('/bingo18/simulate', { body: { bets: [{ bet: { type: 'sum', value: 25 }, stakeUnits: 1 }], drawsPerSession: 3, sessions: 10 } })).status).toBe(422);
    const dec = await api('/bingo18/decision?now=2026-11-20T03:00:00Z'); // 10:00 VN
    expect(dec.body.data.action).toBe('play');
    expect(dec.body.data.plays).toBe(5); // hạn mức mặc định 50.000đ/ngày
    expect(dec.body.data.bestBet.bet.type).toBe('single');
    const late = await api('/bingo18/decision?now=2026-11-20T15:00:00Z'); // 22:00 VN
    expect(late.body.data.action).toBe('skip');
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    expect((await api('/bingo18/ledger', { body: { stake: 40000, prize: 12000, entry_date: today } })).status).toBe(201);
    const over = await api('/bingo18/ledger', { body: { stake: 20000, entry_date: today } });
    expect(over.status).toBe(422);
    expect(over.body.error.message).toContain('Bingo18 mỗi ngày');
    expect((await api('/bingo18/ledger', { body: { stake: 15000 } })).status).toBe(400); // không phải bội số 10.000
    expect((await api('/games/bingo18/probability')).status).toBe(422); // engine riêng
  });

  it('Lịch quay 6 phút từ 06:00 đến 21:53', () => {
    // 06:00 + 6 phút × k ≤ 21:53 ⇒ 159 kỳ/ngày (khớp dữ liệu thực tế: 617 ngày có đúng 159 kỳ).
    expect(bingoDrawsRemaining('2026-11-19T22:00:00Z')).toMatchObject({ remaining: 159, perDay: 159, nextAt: '06:00' }); // 05:00 VN
    expect(bingoDrawsRemaining('2026-11-20T14:40:00Z')).toMatchObject({ remaining: 2, nextAt: '21:42' }); // 21:40 VN
    expect(bingoDrawsRemaining('2026-11-20T14:50:00Z').remaining).toBe(0);
  });
});
