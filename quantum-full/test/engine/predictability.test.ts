import { describe, expect, it } from 'vitest';
import { LOTTO535, POWER655, syntheticDraws } from '../fixtures';
import { matchMoments, predictabilityAudit } from '../../src/engine/predictability';
import { portfolioOdds } from '../../src/engine/portfolioOdds';
import { anyPrizeProbability, expectedValue } from '../../src/engine/probability';
import { rToNumber } from '../../src/engine/combinatorics';
import type { DrawRecord, Ticket } from '../../src/engine/types';

describe('Phán quyết khả năng dự đoán', () => {
  it('Mômen số trùng siêu bội chính xác: Lotto 5/35 có trung bình 25/35', () => {
    const m = matchMoments(LOTTO535);
    expect(m.mean).toBeCloseTo(25 / 35, 12);
    expect(m.variance).toBeGreaterThan(0);
  });

  it('Dưới 200 kỳ ⇒ chưa đủ dữ liệu', () => {
    const r = predictabilityAudit(LOTTO535, syntheticDraws(LOTTO535, 150, 'small'));
    expect(r.verdict).toBe('insufficient');
    expect(r.tests).toHaveLength(0);
  });

  it('Lịch sử đồng đều ⇒ không có chiến lược nào vượt ngẫu nhiên', () => {
    const r = predictabilityAudit(LOTTO535, syntheticDraws(LOTTO535, 600, 'uniform-audit'), { nullSimulations: 30 });
    expect(r.verdict).not.toBe('exploitable');
    expect(r.tests.map((t) => t.code)).toEqual(['main_uniform', 'special_uniform', 'pair_uniform', 'repeat_previous', 'special_markov', 'sum_distribution']);
    expect(r.strategies.map((s) => s.code)).toEqual(['main_hot', 'main_cold', 'main_repeat', 'main_overdue', 'special_hot', 'special_repeat']);
    for (const t of [...r.tests, ...r.strategies]) {
      expect(t.pValue).toBeGreaterThanOrEqual(0);
      expect(t.pValue).toBeLessThanOrEqual(1);
      expect(t.qValue).toBeGreaterThanOrEqual(t.pValue - 1e-12);
    }
  });

  it('Lịch sử cố tình lệch (số 07 luôn xuất hiện) ⇒ phát hiện chiến lược "nóng" khai thác được', () => {
    const biased: DrawRecord[] = syntheticDraws(LOTTO535, 500, 'biased').map((d) => (d.main.includes(7) ? d : { ...d, main: [7, ...d.main.slice(1)].sort((a, b) => a - b) }));
    const r = predictabilityAudit(LOTTO535, biased, { nullSimulations: 20 });
    expect(r.verdict).toBe('exploitable');
    const hot = r.strategies.find((s) => s.code === 'main_hot')!;
    expect(hot.beatsRandom).toBe(true);
    expect(hot.observed).toBeGreaterThan(hot.expected);
  });

  it('Không nhìn trước: chiến lược "lặp kỳ trước" chỉ dùng kỳ i−1', () => {
    // Mọi kỳ giống hệt nhau ⇒ lặp kỳ trước trúng đủ 5 số ở mọi bước chấm điểm.
    const same: DrawRecord[] = Array.from({ length: 220 }, (_, i) => ({ id: i, drawCode: String(i), drawAt: new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString(), main: [1, 2, 3, 4, 5], special: 1 }));
    const r = predictabilityAudit(LOTTO535, same, { nullSimulations: 20 });
    const rep = r.strategies.find((s) => s.code === 'main_repeat')!;
    expect(rep.observed).toBe(5);
    expect(rep.steps).toBe(220 - r.warmup);
  });

  it('Power 6/55: không có kiểm định chuyển tiếp số đặc biệt', () => {
    const r = predictabilityAudit(POWER655, syntheticDraws(POWER655, 300, 'power-audit'), { nullSimulations: 20 });
    expect(r.tests.some((t) => t.code === 'special_markov')).toBe(false);
    expect(r.strategies.some((s) => s.target === 'special')).toBe(false);
  });
});

describe('Xác suất chính xác của danh mục vé', () => {
  it('1 vé: khớp xác suất trúng & kỳ vọng giải tích', () => {
    const o = portfolioOdds(LOTTO535, [{ main: [1, 2, 3, 4, 5], special: 1 }]);
    expect(o.method).toBe('exact');
    expect(o.outcomes).toBe(324_632 * 12);
    expect(o.pAnyPrize).toBeCloseTo(rToNumber(anyPrizeProbability(LOTTO535)), 12);
    expect(o.pAnyPrizeIndependent).toBeCloseTo(o.pAnyPrize, 12);
    expect(o.expectedPayout).toBeCloseTo(expectedValue(LOTTO535).expectedPrize, 6);
    expect(o.buckets.reduce((s, b) => s + b.probability, 0)).toBeCloseTo(1, 12);
  });

  it('12 vé phủ đủ 12 số đặc biệt ⇒ chắc chắn có vé trúng', () => {
    const tickets: Ticket[] = Array.from({ length: 12 }, (_, i) => ({ main: [1, 2, 3, 4, 5], special: i + 1 }));
    const o = portfolioOdds(LOTTO535, tickets);
    expect(o.pAnyPrize).toBeCloseTo(1, 12);
  });

  it('Phối hợp vé tăng P(≥1 vé trúng) so với chọn độc lập, kỳ vọng giữ nguyên', () => {
    const spread: Ticket[] = [
      { main: [1, 2, 3, 4, 5], special: 1 },
      { main: [6, 7, 8, 9, 10], special: 2 },
      { main: [11, 12, 13, 14, 15], special: 3 },
      { main: [16, 17, 18, 19, 20], special: 4 },
    ];
    const same: Ticket[] = spread.map((t) => ({ ...t, main: [1, 2, 3, 4, 5], special: 1 })).slice(0, 4);
    const a = portfolioOdds(LOTTO535, spread);
    const b = portfolioOdds(LOTTO535, same);
    expect(a.pAnyPrize).toBeGreaterThan(a.pAnyPrizeIndependent);
    expect(a.pAnyPrize).toBeGreaterThan(b.pAnyPrize);
    expect(a.expectedPayout).toBeCloseTo(b.expectedPayout, 6);
    expect(a.expectedPayout).toBeCloseTo(4 * expectedValue(LOTTO535).expectedPrize, 6);
  });

  it('Jackpot hiện tại làm tăng kỳ vọng đúng p·ΔJ', () => {
    const t: Ticket[] = [{ main: [1, 2, 3, 4, 5], special: 1 }];
    const a = portfolioOdds(LOTTO535, t);
    const b = portfolioOdds(LOTTO535, t, { jackpot: 12_000_000_000 });
    expect(b.expectedPayout - a.expectedPayout).toBeCloseTo((6_000_000_000 / 324_632) / 12, 6);
    expect(b.jackpotsUsed.jackpot).toBe(12_000_000_000);
  });

  it('Power 6/55: Monte Carlo có seed, tái lập được, khoảng tin cậy chứa giá trị lý thuyết', () => {
    const t: Ticket[] = [{ main: [1, 2, 3, 4, 5, 6], special: null }];
    const a = portfolioOdds(POWER655, t);
    const b = portfolioOdds(POWER655, t);
    expect(a.method).toBe('monte_carlo');
    expect(a.pAnyPrize).toBe(b.pAnyPrize);
    const p = rToNumber(anyPrizeProbability(POWER655));
    expect(a.ci95!.low).toBeLessThanOrEqual(p);
    expect(a.ci95!.high).toBeGreaterThanOrEqual(p);
  });

  it('Từ chối danh mục rỗng hoặc quá lớn', () => {
    expect(() => portfolioOdds(LOTTO535, [])).toThrow();
    expect(() => portfolioOdds(LOTTO535, Array.from({ length: 51 }, () => ({ main: [1, 2, 3, 4, 5], special: 1 })))).toThrow();
  });
});
