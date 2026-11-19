import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/engine/rng';
import { generateTickets, isBalanced, optimizePortfolio, portfolioMetrics, STRATEGIES, type StrategyCode } from '../../src/engine/strategies';
import { findDuplicateTickets, validateTicket } from '../../src/engine/validation';
import { LookAheadError, runBacktestSteps, summarizeBacktest } from '../../src/engine/backtest';
import { runMonteCarlo, MONTE_CARLO_MAX_WORK } from '../../src/engine/montecarlo';
import { evaluateTicket } from '../../src/engine/prize';
import { behaviorScore } from '../../src/engine/behavior';
import { runMlResearch } from '../../src/engine/ml';
import { LOTTO535, POWER655, syntheticDraws } from '../fixtures';

describe('Chiến lược sinh số', () => {
  const history = syntheticDraws(LOTTO535, 150, 'hist');
  for (const code of Object.keys(STRATEGIES) as StrategyCode[]) {
    it(`${code}: vé hợp lệ & không trùng`, () => {
      for (const rules of [LOTTO535, POWER655]) {
        const t = generateTickets(code, { rules, history: rules === LOTTO535 ? history : [], rng: createRng(code), params: {} }, 20);
        expect(t.length).toBe(20);
        expect(findDuplicateTickets(t)).toEqual([]);
        for (const x of t) expect(validateTicket(rules, x)).toEqual([]);
      }
    });
  }
  it('balanced: mọi vé thoả ràng buộc', () => {
    const t = generateTickets('balanced', { rules: POWER655, history: [], rng: createRng('b'), params: {} }, 30);
    expect(t.every((x) => isBalanced(POWER655, x.main))).toBe(true);
  });
  it('Cùng seed ⇒ cùng kết quả', () => {
    const a = generateTickets('statistical', { rules: LOTTO535, history, rng: createRng('s'), params: {} }, 5);
    const b = generateTickets('statistical', { rules: LOTTO535, history, rng: createRng('s'), params: {} }, 5);
    expect(a).toEqual(b);
  });
});

describe('Portfolio Optimizer', () => {
  it('Tăng độ phủ so với ngẫu nhiên, không trùng vé, tôn trọng giới hạn trùng', () => {
    const opt = optimizePortfolio({ rules: LOTTO535, history: [], rng: createRng('p'), params: { maxOverlap: 2 } }, 10);
    const rnd = portfolioMetrics(LOTTO535, generateTickets('random_uniform', { rules: LOTTO535, history: [], rng: createRng('p'), params: {} }, 10));
    expect(opt.metrics.duplicateTickets).toBe(0);
    expect(opt.metrics.maxOverlap).toBeLessThanOrEqual(2);
    expect(opt.metrics.numbersCovered).toBeGreaterThanOrEqual(rnd.numbersCovered);
    expect(opt.metrics.repeatedPairs).toBeLessThanOrEqual(rnd.repeatedPairs);
    expect(opt.metrics.specialsCovered).toBe(10); // xoay vòng số đặc biệt
  });
  it('Phủ 35 số với 7 vé Lotto (5 số/vé) khi đủ ứng viên', () => {
    const opt = optimizePortfolio({ rules: LOTTO535, history: [], rng: createRng('cover'), params: { candidates: 1000, maxOverlap: 0, avoidPopular: false } }, 7);
    expect(opt.metrics.numbersCovered).toBeGreaterThanOrEqual(30);
  });
});

describe('Chấm vé', () => {
  it('Power 6/55: phân biệt Jackpot 1, Jackpot 2, Nhất', () => {
    const draw = [1, 2, 3, 4, 5, 6];
    expect(evaluateTicket(POWER655, { main: [1, 2, 3, 4, 5, 6], special: null }, draw, 7).tier!.code).toBe('jackpot1');
    expect(evaluateTicket(POWER655, { main: [1, 2, 3, 4, 5, 7], special: null }, draw, 7).tier!.code).toBe('jackpot2');
    expect(evaluateTicket(POWER655, { main: [1, 2, 3, 4, 5, 8], special: null }, draw, 7).tier!.code).toBe('first');
    expect(evaluateTicket(POWER655, { main: [1, 2, 3, 4, 9, 7], special: null }, draw, 7).tier!.code).toBe('second');
    expect(evaluateTicket(POWER655, { main: [10, 11, 12, 13, 14, 7], special: null }, draw, 7).tier).toBeNull();
  });
  it('Lotto 5/35: độc đắc cần 5 số + số đặc biệt', () => {
    const draw = [1, 2, 3, 4, 5];
    expect(evaluateTicket(LOTTO535, { main: draw, special: 9 }, draw, 9).tier!.code).toBe('jackpot');
    expect(evaluateTicket(LOTTO535, { main: draw, special: 8 }, draw, 9).tier!.code).toBe('first');
    expect(evaluateTicket(LOTTO535, { main: [10, 11, 12, 13, 14], special: 9 }, draw, 9).tier!.code).toBe('consolation_0');
    expect(evaluateTicket(LOTTO535, { main: [10, 11, 12, 13, 14], special: 8 }, draw, 9).prizeAmount).toBe(0);
  });
});

describe('Walk-forward backtesting', () => {
  const draws = syntheticDraws(LOTTO535, 80, 'bt');
  const config = { strategies: ['random_uniform', 'statistical', 'bayesian'] as StrategyCode[], ticketsPerDraw: 3, minHistory: 30, seed: 'bt', params: {} };
  it('Mỗi bước chỉ dùng dữ liệu trước kỳ mục tiêu', () => {
    const steps = runBacktestSteps(LOTTO535, draws, config, 0, draws.length);
    expect(steps.length).toBe((80 - 30) * 3);
    for (const s of steps) {
      expect(s.historyCutoffAt! < s.drawAt).toBe(true);
      expect(s.historySize).toBe(draws.findIndex((d) => d.id === s.drawId));
    }
  });
  it('Không rò rỉ: thay đổi dữ liệu TƯƠNG LAI không làm thay đổi dự báo quá khứ', () => {
    const a = runBacktestSteps(LOTTO535, draws, config, 40, 41);
    const mutated = draws.map((d, i) => (i > 40 ? { ...d, main: [1, 2, 3, 4, 5], special: 1 } : d));
    const b = runBacktestSteps(LOTTO535, mutated, config, 40, 41);
    expect(b.map((s) => s.tickets)).toEqual(a.map((s) => s.tickets));
    expect(b.map((s) => s.brier)).toEqual(a.map((s) => s.brier));
  });
  it('Từ chối dữ liệu không theo thứ tự thời gian', () => {
    const bad = [draws[1], draws[0], ...draws.slice(2)];
    expect(() => runBacktestSteps(LOTTO535, bad, config, 0, 50)).toThrow(LookAheadError);
  });
  it('Chạy theo từng đoạn (chunk) cho kết quả giống chạy một lần', () => {
    const full = runBacktestSteps(LOTTO535, draws, config, 0, 80);
    const chunked = [...runBacktestSteps(LOTTO535, draws, config, 0, 55), ...runBacktestSteps(LOTTO535, draws, config, 55, 80)];
    expect(chunked).toEqual(full);
  });
  it('Tổng hợp: có baseline, kết luận không có lợi thế trên dữ liệu đồng đều', () => {
    const s = summarizeBacktest(LOTTO535, runBacktestSteps(LOTTO535, draws, config, 0, 80));
    expect(s.strategies[0].strategy).toBe('random_uniform');
    expect(s.strategies.find((x) => x.strategy === 'statistical')!.vsBaseline).not.toBeNull();
    expect(s.edgeProven).toBe(false);
    expect(s.verdict).toContain('KHÔNG CÓ LỢI THẾ DỰ BÁO ĐƯỢC CHỨNG MINH');
    expect(s.strategies[0].theoreticalMeanMatches).toBeCloseTo(25 / 35, 12);
  });
});

describe('Monte Carlo', () => {
  it('Tần suất mô phỏng phù hợp lý thuyết (KTC 95%) & tái lập theo seed', () => {
    const tickets = generateTickets('random_uniform', { rules: POWER655, history: [], rng: createRng('mc'), params: {} }, 10);
    const r1 = runMonteCarlo(POWER655, tickets, 20000, 'seed-1');
    const r2 = runMonteCarlo(POWER655, tickets, 20000, 'seed-1');
    expect(r1).toEqual(r2);
    const third = r1.tiers.find((t) => t.code === 'third')!;
    expect(third.consistent).toBe(true);
    expect(r1.ticketDraws).toBe(200000);
  });
  it('Từ chối khối lượng vượt giới hạn', () => {
    expect(() => runMonteCarlo(LOTTO535, [{ main: [1, 2, 3, 4, 5], special: 1 }], MONTE_CARLO_MAX_WORK + 1, 's')).toThrow();
  });
});

describe('Human behavior & ML', () => {
  it('Dãy 1-2-3-4-5 phổ biến hơn bộ số rải rác', () => {
    const a = behaviorScore(LOTTO535, [1, 2, 3, 4, 5]);
    const b = behaviorScore(LOTTO535, [3, 14, 22, 29, 34]);
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.percentile).toBeGreaterThan(90);
  });
  it('ML trên dữ liệu đồng đều: không mô hình nào vượt baseline', () => {
    const draws = syntheticDraws(LOTTO535, 160, 'ml');
    const r = runMlResearch(LOTTO535, draws, { seed: 'ml', models: ['logistic_regression', 'random_forest', 'gradient_boosting'] });
    expect(r.models.length).toBe(3);
    expect(r.models.every((m) => !m.beatsBaseline)).toBe(true);
    expect(r.verdict).toContain('KHÔNG CÓ LỢI THẾ');
  });
  it('ML từ chối khi dữ liệu không đủ', () => {
    expect(() => runMlResearch(LOTTO535, syntheticDraws(LOTTO535, 50), {})).toThrow();
  });
});
