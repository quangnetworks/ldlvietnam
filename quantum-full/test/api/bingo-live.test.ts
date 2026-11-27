import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { api, VIEWER } from './helpers';

describe('API phiên Bingo18 trực tiếp', () => {
  it('Mở phiên, ghi kỳ (tự tính thưởng), ghi sổ quỹ, không ghi trùng kỳ, kết thúc phiên', async () => {
    const empty = await api('/bingo18/live', { token: VIEWER });
    expect(empty.status).toBe(200);
    expect(empty.body.data.session).toBeNull();
    expect(empty.body.data.schedule.perDay).toBe(159);

    expect((await api('/bingo18/live/start', { body: { bet: { type: 'single', value: 1 } }, token: VIEWER })).status).toBe(403);
    const start = await api('/bingo18/live/start', { body: { bet: { type: 'single', value: 1 }, base_units: 1, budget: 50_000, take_profit: 30_000, max_minutes: 60 } });
    expect(start.status).toBe(201);
    const id = start.body.data.session.id;
    expect(start.body.data.session.betLabel).toBe('Chọn số 1');
    expect((await api('/bingo18/live/start', { body: { bet: { type: 'big' } } })).status).toBe(409);

    const r1 = await api(`/bingo18/live/${id}/round`, { body: { draw_at: '08:36', played: true, result: [1, 1, 4] } });
    expect(r1.status).toBe(201);
    expect(r1.body.data.rounds[0]).toMatchObject({ drawAt: '08:36', stake: 10_000, prize: 20_000, result: [1, 1, 4] });
    expect((await api(`/bingo18/live/${id}/round`, { body: { draw_at: '08:36', played: true, result: [2, 2, 2] } })).status).toBe(409);
    expect((await api(`/bingo18/live/${id}/round`, { body: { draw_at: '08:37', played: true } })).status).toBe(422);
    const r2 = await api(`/bingo18/live/${id}/round`, { body: { draw_at: '08:42', played: false } });
    expect(r2.body.data.rounds).toHaveLength(2);

    const ledger = await env.DB.prepare("SELECT entry_type, amount FROM bankroll_ledger WHERE note = ? ORDER BY id").bind(`Phiên #${id}, kỳ 08:36`).all<{ entry_type: string; amount: number }>();
    expect(ledger.results).toEqual([
      { entry_type: 'purchase', amount: -10_000 },
      { entry_type: 'prize', amount: 20_000 },
    ]);
    await expect(env.DB.prepare('DELETE FROM bingo18_session_rounds WHERE session_id = ?').bind(id).run()).rejects.toThrow(/immutable/);

    const live = await api('/bingo18/live', { token: VIEWER });
    expect(live.body.data.session.id).toBe(id);
    expect(['play', 'stop']).toContain(live.body.data.plan.action);

    const close = await api(`/bingo18/live/${id}/close`, { body: { reason: 'Đạt mục tiêu' } });
    expect(close.status).toBe(200);
    expect(close.body.data.session.status).toBe('closed');
    expect(close.body.data.plan).toBeNull();
    expect((await api(`/bingo18/live/${id}/round`, { body: { draw_at: '08:48', played: false } })).status).toBe(409);
  });

  it('Kiểm tra đầu vào', async () => {
    expect((await api('/bingo18/live/start', { body: { bet: { type: 'single', value: 9 } } })).status).toBe(422);
    expect((await api('/bingo18/live/start', { body: { bet: { type: 'big' }, base_units: 5, budget: 10_000 } })).status).toBe(422);
    expect((await api('/bingo18/live', { token: null })).status).toBe(401);
  });
});
