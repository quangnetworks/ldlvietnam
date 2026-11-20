import { describe, expect, it } from 'vitest';
import { allOutcomes, analyzeBet, betCatalog, bingoStatistics, exactSumCounts, payout, simulateSessions, type BingoResult } from '../../src/engine/bingo18';
import { createRng } from '../../src/engine/rng';

describe('Bingo18 — xác suất chính xác (216 kết quả)', () => {
  it('Không gian mẫu & phân phối tổng (đếm tay: 1,3,6,10,15,21,25,27)', () => {
    expect(allOutcomes().length).toBe(216);
    const c = exactSumCounts();
    expect([3, 4, 5, 6, 7, 8, 9, 10].map((s) => c[s])).toEqual([1, 3, 6, 10, 15, 21, 25, 27]);
    expect([18, 17, 16, 15, 14, 13, 12, 11].map((s) => c[s])).toEqual([1, 3, 6, 10, 15, 21, 25, 27]);
  });
  it('Chọn 1 số: P(1 lần)=75/216, P(2)=15/216, P(3)=1/216 ⇒ EV = 1.230.000/216', () => {
    const a = analyzeBet({ type: 'single', value: 4 });
    expect(a.winProbability).toEqual({ num: 91n, den: 216n });
    expect(a.expectedPayout).toBeCloseTo((75 * 12000 + 15 * 20000 + 30000) / 216, 9);
    expect(a.returnRatio).toBeCloseTo(0.569444, 5);
  });
  it('Hai số trùng: 16/216 × 75.000; Ba số trùng đúng: 1/216 × 1,2tr; bất kỳ: 6/216 × 200k', () => {
    expect(analyzeBet({ type: 'pair', value: 2 }).expectedPayout).toBeCloseTo((16 * 75000) / 216, 9);
    expect(analyzeBet({ type: 'triple', value: 6 }).expectedPayout).toBeCloseTo(1200000 / 216, 9);
    expect(analyzeBet({ type: 'any_triple' }).expectedPayout).toBeCloseTo((6 * 200000) / 216, 9);
  });
  it('Lớn/Nhỏ 81/216 × 15k; Hoà 54/216 × 20k; Tổng 10: 27/216 × 44k', () => {
    expect(analyzeBet({ type: 'big' }).winProbability).toEqual({ num: 3n, den: 8n });
    expect(analyzeBet({ type: 'small' }).expectedPayout).toBeCloseTo((81 * 15000) / 216, 9);
    expect(analyzeBet({ type: 'draw' }).expectedPayout).toBeCloseTo((54 * 20000) / 216, 9);
    expect(analyzeBet({ type: 'sum', value: 10 }).expectedPayout).toBeCloseTo((27 * 44000) / 216, 9);
  });
  it('Mọi cược có tỷ lệ hoàn trả < 100% (≈ 50–57%); cao nhất là "Chọn 1 số"', () => {
    const cat = betCatalog();
    expect(cat.every((b) => b.returnRatio < 0.6 && b.returnRatio >= 0.5)).toBe(true);
    expect(cat.reduce((a, b) => (b.returnRatio > a.returnRatio ? b : a)).bet.type).toBe('single');
  });
  it('Chấm cược', () => {
    expect(payout({ type: 'single', value: 3 }, [3, 3, 1])).toBe(20000);
    expect(payout({ type: 'pair', value: 3 }, [3, 3, 3])).toBe(75000);
    expect(payout({ type: 'triple', value: 3 }, [3, 3, 3])).toBe(1200000);
    expect(payout({ type: 'big' }, [3, 3, 3])).toBe(0);
    expect(payout({ type: 'sum', value: 18 }, [6, 6, 6])).toBe(1200000);
    expect(payout({ type: 'draw' }, [4, 4, 2])).toBe(20000);
  });
});

describe('Bingo18 — thống kê & mô phỏng', () => {
  const rng = createRng('bingo');
  const results: BingoResult[] = Array.from({ length: 20000 }, () => [rng.int(1, 6), rng.int(1, 6), rng.int(1, 6)]);
  it('Dữ liệu đồng đều: không bác bỏ H0; tần suất Lớn sau chuỗi Lớn ≈ 37,5%', () => {
    const s = bingoStatistics(results);
    expect(s.facesChiSquare.pValue).toBeGreaterThan(0.001);
    expect(s.sumsChiSquare.pValue).toBeGreaterThan(0.001);
    expect(s.triples.expected).toBeCloseTo((20000 * 6) / 216, 9);
    expect(Math.abs(s.bigAfterBigStreak[2].rate - 0.375)).toBeLessThan(0.05);
  });
  it('Mô phỏng phiên: trung bình gần EV, tái lập theo seed, giới hạn khối lượng', () => {
    const a = simulateSessions({ bets: [{ bet: { type: 'single', value: 1 }, stakeUnits: 1 }], drawsPerSession: 50, sessions: 3000, seed: 's' });
    const b = simulateSessions({ bets: [{ bet: { type: 'single', value: 1 }, stakeUnits: 1 }], drawsPerSession: 50, sessions: 3000, seed: 's' });
    expect(a).toEqual(b);
    const ev = 50 * (1230000 / 216 - 10000);
    expect(a.meanNet.low).toBeLessThan(ev);
    expect(a.meanNet.high).toBeGreaterThan(ev);
    expect(() => simulateSessions({ bets: [{ bet: { type: 'big' }, stakeUnits: 1 }], drawsPerSession: 1000, sessions: 3000, seed: 'x' })).toThrow();
    expect(() => simulateSessions({ bets: [{ bet: { type: 'sum', value: 2 }, stakeUnits: 1 }], drawsPerSession: 1, sessions: 10, seed: 'x' })).toThrow();
  });
});
