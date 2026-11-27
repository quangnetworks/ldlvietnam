import { describe, expect, it } from 'vitest';
import { OFFICIAL_PAYTABLE, analyzeBet, type BingoPayTable } from '../../src/engine/bingo18';
import { allBets, guaranteedNet, hedgeBound, simulateStakeStrategies } from '../../src/engine/bingoStrategy';
import { createRng } from '../../src/engine/rng';

describe('Bingo18: không tổ hợp cược nào lãi chắc chắn', () => {
  it('38 cửa cược; cận trên = kỳ vọng cửa tốt nhất (Chọn số, 56,9%) < 0; tổ hợp phòng thủ tốt nhất vẫn lỗ chắc chắn', () => {
    const h = hedgeBound();
    expect(h.betsConsidered).toBe(38);
    expect(h.profitableMixExists).toBe(false);
    expect(h.upperBound).toBeCloseTo((1230000 / 216) - 10000, 6); // (75·12k + 15·20k + 1·30k)/216 − 10k
    expect(h.hedge.guaranteed).toBeLessThan(0);
    expect(h.hedge.guaranteed).toBeLessThanOrEqual(h.upperBound + 1e-9);
    expect(h.hedge.guaranteed).toBeGreaterThan(-4400); // lời giải quy hoạch tuyến tính ≈ −4.313đ
    expect(h.hedge.mix.reduce((s, m) => s + m.weight, 0)).toBeCloseTo(1, 9);
  });

  it('Mọi tổ hợp ngẫu nhiên đều có lãi/lỗ tệ nhất ≤ cận trên (không có ngoại lệ)', () => {
    const bets = allBets();
    const rng = createRng('random-mixes');
    const upper = hedgeBound().upperBound;
    for (let i = 0; i < 60; i++) {
      const mix = bets.map((bet) => ({ bet, weight: rng.next() ** 3 }));
      expect(guaranteedNet(mix).net).toBeLessThanOrEqual(upper + 1e-9);
    }
  });

  it('Đối chứng: nếu bảng thưởng có lợi cho người chơi thì engine phát hiện được', () => {
    const generous: BingoPayTable = { ...OFFICIAL_PAYTABLE, single: [24_000, 40_000, 60_000] };
    expect(analyzeBet({ type: 'single', value: 1 }, generous).returnRatio).toBeGreaterThan(1);
    const h = hedgeBound(generous);
    expect(h.profitableMixExists).toBe(true);
    expect(h.hedge.guaranteed).toBeGreaterThan(0);
  });
});

describe('Bingo18: mô phỏng chiến thuật tăng giảm tiền cược', () => {
  const base = { bet: { type: 'big' as const }, baseUnits: 1, budget: 200_000, takeProfit: 50_000, maxRounds: 60, sessions: 4000, seed: 'strat' };

  it('Bảo đảm cứng: không chiến thuật nào lỗ quá ngân sách; gấp thếp không làm có lãi', () => {
    const r = simulateStakeStrategies(base);
    expect(r.map((x) => x.code)).toEqual(['flat', 'martingale', 'paroli', 'flat_no_stop']);
    for (const x of r) {
      expect(x.worst).toBeGreaterThanOrEqual(-base.budget);
      expect(x.meanNet).toBeLessThan(0);
    }
    expect(r.find((x) => x.code === 'martingale')!.probabilityProfit).toBeLessThan(0.05);
  });

  it('Cùng seed ⇒ cùng kết quả; dữ liệu đầu vào sai bị từ chối', () => {
    expect(simulateStakeStrategies(base)).toEqual(simulateStakeStrategies(base));
    expect(() => simulateStakeStrategies({ ...base, budget: 5_000 })).toThrow();
    expect(() => simulateStakeStrategies({ ...base, bet: { type: 'single', value: 9 } })).toThrow();
    expect(() => simulateStakeStrategies({ ...base, sessions: 1_000_000, maxRounds: 160 })).toThrow();
  });

  it('Chốt lời có hiệu lực: chiến thuật có chốt lời dừng ở ≥ mức chốt khi đạt', () => {
    const r = simulateStakeStrategies({ ...base, bet: { type: 'single', value: 1 }, takeProfit: 10_000, maxRounds: 30 });
    const flat = r.find((x) => x.code === 'flat')!;
    expect(flat.probabilityTakeProfit).toBeGreaterThan(0);
    expect(flat.p95).toBeLessThan(base.budget);
  });
});
