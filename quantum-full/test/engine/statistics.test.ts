import { describe, expect, it } from 'vitest';
import { comboFrequency, distributionAnalysis, exactSumDistribution, frequencyAnalysis, rollingWindows } from '../../src/engine/statistics';
import { bayesianAnalysis } from '../../src/engine/bayesian';
import { markovAnalysis } from '../../src/engine/markov';
import { LOTTO535, POWER655, syntheticDraws } from '../fixtures';
import type { DrawRecord } from '../../src/engine/types';

const hand: DrawRecord[] = [
  { id: 1, drawCode: '1', drawAt: '2025-01-01T13:00:00Z', main: [1, 2, 3, 4, 5], special: 1 },
  { id: 2, drawCode: '2', drawAt: '2025-01-01T21:00:00Z', main: [1, 2, 10, 20, 30], special: 2 },
  { id: 3, drawCode: '3', drawAt: '2025-01-02T13:00:00Z', main: [1, 11, 21, 31, 35], special: 1 },
];

describe('Thống kê tần suất (dữ liệu tay)', () => {
  const f = frequencyAnalysis(LOTTO535, hand);
  it('Đếm đúng và kỳ vọng = n·K/N', () => {
    expect(f.numbers.find((x) => x.number === 1)!.count).toBe(3);
    expect(f.numbers.find((x) => x.number === 2)!.count).toBe(2);
    expect(f.numbers.find((x) => x.number === 6)!.count).toBe(0);
    expect(f.numbers[0].expected).toBeCloseTo((3 * 5) / 35, 12);
    expect(f.numbers.find((x) => x.number === 1)!.lastSeenAgo).toBe(0);
    expect(f.numbers.find((x) => x.number === 3)!.lastSeenAgo).toBe(2);
  });
  it('Độ tin cậy mẫu nhỏ được cảnh báo', () => {
    expect(f.sample.draws).toBe(3);
    expect(f.sample.reliability).toBe('insufficient');
  });
  it('Số đặc biệt', () => {
    expect(f.special!.numbers.find((x) => x.number === 1)!.count).toBe(2);
    expect(f.special!.chiSquare.df).toBe(11);
  });
  it('Cặp số: (1,2) xuất hiện 2 lần; kỳ vọng = n·C(N−2,K−2)/C(N,K)', () => {
    const p = comboFrequency(LOTTO535, hand, 2);
    expect(p.top[0].numbers).toEqual([1, 2]);
    expect(p.top[0].count).toBe(2);
    expect(p.expectedPerCombo).toBeCloseTo((3 * 20) / (35 * 34), 12);
    expect(p.totalCombos).toBe(595);
  });
  it('Phân phối: chẵn/lẻ, liên tiếp', () => {
    const d = distributionAnalysis(LOTTO535, hand);
    expect(d.oddEven.categories.find((c) => c.label.startsWith('3 lẻ'))!.observed).toBe(1); // [1..5]: 3 lẻ; [1,2,10,20,30]: 1 lẻ; [1,11,21,31,35]: 5 lẻ
    expect(d.oddEven.categories.find((c) => c.label.startsWith('5 lẻ'))!.observed).toBe(1);
    expect(d.consecutive.drawsWithConsecutive).toBe(2);
    // P(có ít nhất 1 cặp liên tiếp) = 1 − C(31,5)/C(35,5)
    expect(d.consecutive.expectedShare).toBeCloseTo(1 - 169911 / 324632, 12);
  });
  it('Cửa sổ trượt', () => {
    const r = rollingWindows(LOTTO535, hand, [2]);
    expect(r[0].drawsUsed).toBe(2);
    expect(r[0].numbers.find((x) => x.number === 1)!.count).toBe(2);
  });
});

describe('Phân phối tổng chính xác', () => {
  it('Tổng xác suất = 1, trung bình = K(min+max)/2', () => {
    for (const g of [LOTTO535, POWER655]) {
      const d = exactSumDistribution(g);
      let s = 0, m = 0;
      for (const [k, v] of d) {
        s += v;
        m += k * v;
      }
      expect(s).toBeCloseTo(1, 10);
      expect(m).toBeCloseTo((g.mainPicks * (g.mainMin + g.mainMax)) / 2, 8);
    }
  });
});

describe('Hiệu chỉnh χ² cho rút không hoàn lại', () => {
  it('E[X²] ≈ N − K dưới H0 (mô phỏng 200 lịch sử × 200 kỳ)', () => {
    let s = 0;
    for (let r = 0; r < 200; r++) s += frequencyAnalysis(LOTTO535, syntheticDraws(LOTTO535, 200, `chi-${r}`)).chiSquare.statistic;
    expect(s / 200).toBeGreaterThan(28);
    expect(s / 200).toBeLessThan(32); // N − K = 30
  });
  it('p-value của dữ liệu đồng đều phân bố hợp lý (không bác bỏ quá nhiều)', () => {
    let rejects = 0;
    for (let r = 0; r < 100; r++) if (frequencyAnalysis(LOTTO535, syntheticDraws(LOTTO535, 300, `p-${r}`)).chiSquare.pValue < 0.05) rejects++;
    expect(rejects).toBeLessThan(15);
  });
});

describe('Bayes & Markov trên dữ liệu đồng đều', () => {
  const draws = syntheticDraws(POWER655, 400, 'bm');
  it('Bayes: số khoảng tin cậy loại trừ p₀ gần mức kỳ vọng', () => {
    const b = bayesianAnalysis(POWER655, draws, 100);
    expect(b.posteriors.length).toBe(55);
    expect(b.excludingUniform).toBeLessThanOrEqual(10);
    expect(b.sensitivity[3].spread).toBeLessThan(b.sensitivity[0].spread);
  });
  it('Markov: không bác bỏ độc lập; trùng giữa 2 kỳ ≈ K²/N', () => {
    const m = markovAnalysis(POWER655, draws);
    expect(m.overlap.expectedMean).toBeCloseTo(36 / 55, 12);
    expect(Math.abs(m.overlap.observedMean - 36 / 55)).toBeLessThan(0.15);
    expect(m.pooled.pValue).toBeGreaterThan(0.001);
  });
});
