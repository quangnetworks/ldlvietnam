import { describe, expect, it } from 'vitest';
import { api, importAndVerify, VIEWER } from './helpers';
import { LOTTO535 } from '../fixtures';

describe('API kiểm định dự đoán & xác suất danh mục', () => {
  it('GET /predictability: chưa đủ dữ liệu → insufficient; đủ dữ liệu → có kiểm định & chiến lược; người xem được đọc', async () => {
    const empty = await api('/predictability?game=lotto535');
    expect(empty.status).toBe(200);
    expect(empty.body.data.verdict).toBe('insufficient');

    await importAndVerify('lotto535', LOTTO535, 240, 'audit');
    const r = await api('/predictability?game=lotto535&window=30&warmup=60', { token: VIEWER });
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.draws).toBe(240);
    expect(['random', 'anomaly', 'exploitable']).toContain(d.verdict);
    // 240 kỳ: chưa đủ cho kiểm định cặp số (kỳ vọng < 5/cặp) và bảng chuyển tiếp 12×12.
    expect(d.tests.map((t: { code: string }) => t.code)).toEqual(['main_uniform', 'special_uniform', 'repeat_previous', 'sum_distribution']);
    expect(d.strategies.find((s: { code: string }) => s.code === 'main_hot').steps).toBe(240 - 60);
    expect(r.body.meta.includeUnverified).toBe(false);
  });

  it('GET /predictability: 401 khi chưa đăng nhập, 404 game không tồn tại, 422 với Bingo18, 400 tham số sai', async () => {
    expect((await api('/predictability?game=lotto535', { token: null })).status).toBe(401);
    expect((await api('/predictability?game=khong-co')).status).toBe(404);
    expect((await api('/predictability?game=bingo18')).status).toBe(422);
    expect((await api('/predictability?game=lotto535&window=1')).status).toBe(400);
  });

  it('POST /portfolio/odds: xác suất chính xác, chặn vé sai thể lệ, chỉ admin', async () => {
    const tickets = [
      { main: [1, 2, 3, 4, 5], special: 1 },
      { main: [10, 6, 7, 8, 9], special: 2 },
    ];
    const r = await api('/portfolio/odds', { body: { game: 'lotto535', tickets } });
    expect(r.status).toBe(200);
    expect(r.body.data.method).toBe('exact');
    expect(r.body.data.cost).toBe(20000);
    expect(r.body.data.pAnyPrize).toBeGreaterThan(r.body.data.pAnyPrizeIndependent);

    const bad = await api('/portfolio/odds', { body: { game: 'lotto535', tickets: [{ main: [1, 2, 3, 4, 36], special: 13 }] } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.length).toBeGreaterThanOrEqual(2);

    expect((await api('/portfolio/odds', { body: { game: 'lotto535', tickets: [] } })).status).toBe(400);
    expect((await api('/portfolio/odds', { body: { game: 'lotto535', tickets }, token: VIEWER })).status).toBe(403);
    expect((await api('/portfolio/odds', { body: { game: 'lotto535', tickets }, token: null })).status).toBe(401);
  });
});
