import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { api, importAndVerify } from './helpers';
import { LOTTO535, POWER655 } from '../fixtures';
import { validateTicket, findDuplicateTickets } from '../../src/engine/validation';

const todayVn = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

describe('Number Generator', () => {
  it('Sinh số hợp lệ, lưu lịch sử bất biến, có seed/phiên bản/data cutoff', async () => {
    await importAndVerify('lotto535', LOTTO535, 40, 'gen');
    for (const strategy of ['random_uniform', 'balanced', 'statistical', 'bayesian', 'portfolio_optimized']) {
      const r = await api('/generator/generate', { body: { game: 'lotto535', strategy, budget: 100000, ticket_count: 10, seed: `s-${strategy}` } });
      expect(r.status).toBe(201);
      const d = r.body.data;
      expect(d.tickets.length).toBe(10);
      expect(findDuplicateTickets(d.tickets)).toEqual([]);
      for (const t of d.tickets) expect(validateTicket(LOTTO535, t)).toEqual([]);
      expect(d.totalCost).toBe(100000);
      expect(d.probability.jackpotExact).toBe('5/1947792');
      expect(d.algorithm.version).toBe('1.0.0');
      expect(d.dataCutoff.drawCount).toBe(40);
      expect(d.seed).toBe(`s-${strategy}`);
      expect(d.validationStatus).toBeTruthy();
      const rec = await api(`/recommendations/${d.recommendationId}`);
      expect(rec.body.data.tickets).toEqual(d.tickets.map((t: { main: number[]; special: number }) => ({ main: t.main, special: t.special })));
    }
    // Cùng seed ⇒ cùng kết quả (tái lập)
    const a = await api('/generator/generate', { body: { game: 'lotto535', strategy: 'statistical', budget: 50000, ticket_count: 5, seed: 'repro' } });
    const b = await api('/generator/generate', { body: { game: 'lotto535', strategy: 'statistical', budget: 50000, ticket_count: 5, seed: 'repro' } });
    expect(a.body.data.tickets).toEqual(b.body.data.tickets);
    // Bất biến
    await expect(env.DB.prepare('UPDATE recommendations SET seed = ? WHERE id = ?').bind('x', a.body.data.recommendationId).run()).rejects.toThrow(/immutable/);
    await expect(env.DB.prepare('DELETE FROM recommendation_numbers WHERE recommendation_id = ?').bind(a.body.data.recommendationId).run()).rejects.toThrow(/immutable/);
  });

  it('Không vượt ngân sách / hạn mức mỗi kỳ; không dự báo cho kỳ đã qua', async () => {
    const over = await api('/generator/generate', { body: { game: 'power655', strategy: 'random_uniform', budget: 50000, ticket_count: 6 } });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('budget_violation');
    const overLimit = await api('/generator/generate', { body: { game: 'power655', strategy: 'random_uniform', budget: 500000, ticket_count: 20 } });
    expect(overLimit.status).toBe(422);
    expect(overLimit.body.error.message).toContain('hạn mức mỗi kỳ');
    const past = await api('/generator/generate', { body: { game: 'power655', strategy: 'random_uniform', budget: 10000, ticket_count: 1, target_draw_date: '2020-01-01' } });
    expect(past.status).toBe(422);
    const big = await api('/generator/generate', { body: { game: 'power655', strategy: 'random_uniform', budget: 100000, ticket_count: 201 } });
    expect(big.status).toBe(400);
  });

  it('Portfolio optimizer trả về độ phủ, không trùng vé', async () => {
    const r = await api('/portfolio/optimize', { body: { game: 'power655', budget: 100000, ticket_count: 9, seed: 'opt', params: { maxOverlap: 2 } } });
    expect(r.status).toBe(201);
    expect(r.body.data.coverage.duplicateTickets).toBe(0);
    expect(r.body.data.coverage.maxOverlap).toBeLessThanOrEqual(2);
    expect(r.body.data.coverage.numbersCovered).toBeGreaterThanOrEqual(40);
    expect(r.body.data.explanation).toContain('KHÔNG làm tăng xác suất');
    expect(r.body.data.tickets.every((t: { special: null }) => t.special === null)).toBe(true);
  });
});

describe('Portfolio, Draw Tracking & Capital Control', () => {
  it('Danh mục thực tế: ghi nhận mua có kiểm hạn mức, chấm vé với kết quả đã xác minh, ghi sổ quỹ', async () => {
    const today = todayVn();
    const gen = await api('/generator/generate', { body: { game: 'power655', strategy: 'random_uniform', budget: 30000, ticket_count: 3, target_draw_date: today, seed: 'pf' } });
    const tickets = gen.body.data.tickets as { main: number[] }[];
    const p = await api('/portfolios', { body: { recommendation_id: gen.body.data.recommendationId, name: 'Kỳ hôm nay', mode: 'real', target_draw_date: today } });
    expect(p.status).toBe(201);
    // Chưa mua ⇒ không chấm
    expect((await api(`/portfolios/${p.body.data.id}/evaluate`, { body: {} })).body.data.evaluated).toBe(false);
    const buy = await api(`/portfolios/${p.body.data.id}/purchase`, { body: {} });
    expect(buy.status).toBe(200);
    expect(buy.body.data.status).toBe('purchased');
    expect((await api(`/portfolios/${p.body.data.id}/purchase`, { body: {} })).status).toBe(409);
    // Kết quả quay: trùng 4 số với vé đầu ⇒ Giải Nhì 500.000đ
    const t0 = tickets[0].main;
    const others = Array.from({ length: 55 }, (_, i) => i + 1).filter((x) => !tickets.some((t) => t.main.includes(x)));
    const drawMain = [...t0.slice(0, 4), others[0], others[1]];
    await api('/admin/draws', { body: { game: 'power655', draw_code: 'T-TODAY', draw_date: today, draw_time: '18:00', main: drawMain, special: others[2] } });
    // Chưa xác minh ⇒ chưa chấm
    expect((await api(`/portfolios/${p.body.data.id}/evaluate`, { body: {} })).body.data.evaluated).toBe(false);
    const did = (await api('/draws?game=power655&q=T-TODAY')).body.data[0].id;
    await api(`/admin/draws/${did}/verify`, { body: { status: 'verified' } });
    const ev = await api('/tracking/evaluate', { body: {} });
    const mine = ev.body.data.results.find((x: { portfolioId: number }) => x.portfolioId === p.body.data.id);
    expect(mine.evaluated).toBe(true);
    expect(mine.fixedPrize).toBeGreaterThanOrEqual(500000);
    const detail = await api(`/portfolios/${p.body.data.id}`);
    expect(detail.body.data.tickets[0].result).toMatchObject({ mainMatches: 4, prizeTier: 'second', prizeAmount: 500000 });
    const cap = await api('/capital/summary?mode=real');
    expect(cap.body.data.totalInvestment).toBe(30000);
    expect(cap.body.data.totalPrizes).toBe(mine.fixedPrize);
    expect(cap.body.data.netResult).toBe(mine.fixedPrize - 30000);
    expect(cap.body.data.roi).toBeCloseTo((mine.fixedPrize - 30000) / 30000, 10);
    expect(cap.body.data.budgetPerDraw).toBe(100000);
    // Sổ quỹ bất biến
    await expect(env.DB.prepare('UPDATE bankroll_ledger SET amount = 0').run()).rejects.toThrow(/ledger_immutable/);
  });

  it('Không vượt hạn mức: mua thực tế vượt ngân sách mỗi kỳ / hạn mức tháng bị chặn', async () => {
    const today = todayVn();
    await api('/admin/settings', { method: 'PUT', body: { budget_per_draw: 50000, monthly_budget: 90000, annual_budget: 1000000 } });
    const mk = async (n: number) => {
      const g = await api('/generator/generate', { body: { game: 'lotto535', strategy: 'random_uniform', budget: n * 10000, ticket_count: n, target_draw_date: today } });
      return (await api('/portfolios', { body: { recommendation_id: g.body.data.recommendationId, name: `p${n}`, mode: 'real', target_draw_date: today } })).body.data.id;
    };
    // Hôm nay Power đã chi 30.000đ ở test trước — hạn mức mỗi kỳ tính RIÊNG cho từng game.
    const first = await mk(5);
    expect((await api(`/portfolios/${first}/purchase`, { body: {} })).status).toBe(200);
    const second = await mk(2);
    const blocked = await api(`/portfolios/${second}/purchase`, { body: {} });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('capital_limit');
    expect(blocked.body.error.message).toContain('vượt ngân sách mỗi kỳ');
    // Hạn mức tháng: 30.000 + 50.000 đã chi; thêm 20.000 cho game khác ⇒ vượt 90.000
    const g2 = await api('/generator/generate', { body: { game: 'power655', strategy: 'random_uniform', budget: 20000, ticket_count: 2, target_draw_date: today } });
    const p2 = (await api('/portfolios', { body: { recommendation_id: g2.body.data.recommendationId, name: 'p-month', mode: 'real', target_draw_date: today } })).body.data.id;
    const monthBlocked = await api(`/portfolios/${p2}/purchase`, { body: {} });
    expect(monthBlocked.status).toBe(422);
    expect(monthBlocked.body.error.message).toContain('hạn mức tháng');
    // Danh mục mô phỏng không được ghi nhận mua
    const g = await api('/generator/generate', { body: { game: 'lotto535', strategy: 'random_uniform', budget: 10000, ticket_count: 1 } });
    const sim = (await api('/portfolios', { body: { recommendation_id: g.body.data.recommendationId, name: 'sim', mode: 'simulated', target_draw_date: today } })).body.data.id;
    expect((await api(`/portfolios/${sim}/purchase`, { body: {} })).status).toBe(422);
    // Thiết lập không hợp lệ bị từ chối
    expect((await api('/admin/settings', { method: 'PUT', body: { budget_per_draw: 95000 } })).status).toBe(400);
    expect((await api('/audit?action=settings.update')).body.data.length).toBe(1);
  });
});

describe('Backtesting Center & Models', () => {
  it('Walk-forward chạy theo chunk tới khi hoàn tất, có baseline & kết luận', async () => {
    await importAndVerify('power655', POWER655, 90, 'bt');
    const r = await api('/backtests/run', { body: { game: 'power655', strategies: ['statistical', 'bayesian'], tickets_per_draw: 20, min_history: 30, seed: 'bt' } });
    expect(r.status).toBe(201);
    expect(r.body.data.strategies).toEqual(['random_uniform', 'statistical', 'bayesian']);
    let run = r.body.data;
    let guard = 0;
    while (run.status === 'running' && guard++ < 20) run = (await api(`/backtests/${run.id}/continue`, { body: {} })).body.data;
    expect(guard).toBeGreaterThan(0); // cần nhiều request (chunk)
    expect(run.status).toBe('completed');
    const detail = await api(`/backtests/${run.id}`);
    const s = detail.body.data.summary;
    expect(s.strategies.map((x: { strategy: string }) => x.strategy)).toEqual(['random_uniform', 'bayesian', 'statistical']);
    expect(s.strategies[0].steps).toBe(run.totalDraws - 30);
    expect(typeof s.edgeProven).toBe('boolean');
    if (!s.edgeProven) expect(s.verdict).toContain('KHÔNG CÓ LỢI THẾ DỰ BÁO ĐƯỢC CHỨNG MINH');
    expect(s.biasControls.length).toBeGreaterThan(4);
    const models = await api('/models?game=power655');
    const st = models.body.data.find((m: { code: string }) => m.code === 'statistical');
    expect(st.validation.backtestId).toBe(run.id);
    const runs = await api('/models/runs?run_type=backtest');
    expect(runs.body.data[0].dataset_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Thiếu dữ liệu ⇒ 422 (không tự tạo dữ liệu)', async () => {
    const r = await api('/backtests/run', { body: { game: 'lotto535', strategies: ['statistical'], min_history: 1000 } });
    expect(r.status).toBe(422);
  });

  it('Dữ liệu thay đổi giữa chừng ⇒ phiên backtest bị huỷ', async () => {
    const r = await api('/backtests/run', { body: { game: 'power655', strategies: ['statistical'], tickets_per_draw: 50, min_history: 30, seed: 'chg' } });
    expect(r.body.data.status).toBe('running');
    const ids = (await api('/draws?game=power655&status=verified&page_size=1')).body.data;
    await api(`/admin/draws/${ids[0].id}/correct`, { body: { main: [1, 2, 3, 4, 5, 6], special: 7, reason: 'Kiểm thử thay đổi dữ liệu' } });
    const c = await api(`/backtests/${r.body.data.id}/continue`, { body: {} });
    expect(c.status).toBe(409);
    expect((await api(`/backtests/${r.body.data.id}`)).body.data.run.status).toBe('failed');
  });

  it('Chạy các mô hình nghiên cứu & lưu model run', async () => {
    for (const model of ['statistics', 'bayesian_analysis', 'markov']) {
      const r = await api('/models/run', { body: { game: 'power655', model } });
      expect(r.status).toBe(201);
      expect(r.body.data.modelRunId).toBeGreaterThan(0);
    }
    const mc = await api('/models/run', { body: { game: 'power655', model: 'monte_carlo', seed: 'mc', params: { draws: 5000, ticketCount: 5 } } });
    expect(mc.body.data.result.ticketDraws).toBe(25000);
    const ml = await api('/models/run', { body: { game: 'power655', model: 'ml_research', seed: 'ml', params: { models: ['logistic_regression'] } } });
    expect(ml.status).toBe(201);
    expect(ml.body.data.result.models[0].model).toBe('logistic_regression');
    const bh = await api('/models/run', { body: { game: 'lotto535', model: 'behavior', params: { numbers: [1, 2, 3, 4, 5] } } });
    expect(bh.body.data.result.percentile).toBeGreaterThan(90);
    const badMc = await api('/models/run', { body: { game: 'power655', model: 'monte_carlo', params: { draws: 2_000_000, ticketCount: 5 } } });
    expect(badMc.status).toBe(422);
    const dash = await api('/dashboard?game=power655');
    expect(dash.status).toBe(200);
    expect(dash.body.data.probability.jackpot.exact).toBe('1/28989675');
  });
});
