import { describe, expect, it } from 'vitest';
import { LOTTO535 } from '../fixtures';
import { LOTTO535_SPLIT_SHARES, breakEvenTickets, estimateTickets, splitDrawEV, validateShares } from '../../src/engine/splitDraw';
import { expectedValue, tierProbabilities } from '../../src/engine/probability';
import { createRng } from '../../src/engine/rng';
import { rToNumber } from '../../src/engine/combinatorics';

const S = LOTTO535_SPLIT_SHARES;

function poisson(rng: ReturnType<typeof createRng>, l: number): number {
  if (l > 60) {
    const z = Math.sqrt(-2 * Math.log(rng.next() + 1e-12)) * Math.cos(2 * Math.PI * rng.next());
    return Math.max(0, Math.round(l + Math.sqrt(l) * z));
  }
  const L = Math.exp(-l);
  let k = 0;
  let q = 1;
  do {
    k++;
    q *= rng.next();
  } while (q > L);
  return k - 1;
}

describe('Kỳ Chia giải Độc đắc', () => {
  it('Tỷ lệ chia Lotto 5/35 hợp lệ; từ chối tỷ lệ sai', () => {
    expect(validateShares(LOTTO535, S)).toBeNull();
    expect(validateShares(LOTTO535, { first: 0.5 })).toMatch(/Tổng/);
    expect(validateShares(LOTTO535, { jackpot: 1 })).toMatch(/không phải/);
  });

  it('Không thuế, T lớn: kỳ vọng ≈ kỳ vọng cố định + J/T (toàn bộ Độc đắc trả cho người chơi kỳ đó)', () => {
    const J = 16e9;
    const T = 1e6;
    const fixed = expectedValue(LOTTO535).expectedPrizeFixedOnly;
    const e = splitDrawEV(LOTTO535, J, T, S, false);
    expect(e.expectedPrize).toBeGreaterThan(fixed);
    expect(Math.abs(e.expectedPrize - (fixed + J / T)) / (fixed + J / T)).toBeLessThan(0.01);
  });

  it('Khớp mô phỏng Monte Carlo độc lập (có thuế, hạng trống, có người trúng Độc đắc)', () => {
    const J = 16e9;
    const T = 1e6;
    const exact = splitDrawEV(LOTTO535, J, T, S, true).expectedPrize;
    const tps = tierProbabilities(LOTTO535).map((t) => ({ code: t.tier.code, fixed: t.tier.amount, kind: t.tier.kind, p: rToNumber(t.probability) }));
    const share = ['first', 'second', 'third', 'fourth', 'fifth'];
    const tax = (a: number) => (a <= 10e6 ? a : a - 0.1 * (a - 10e6));
    const rng = createRng('split-mc');
    let tot = 0;
    const B = 3000;
    for (let b = 0; b < B; b++) {
      const N: Record<string, number> = {};
      for (const t of tps) N[t.code] = poisson(rng, T * t.p);
      let e = 0;
      for (const t of tps) {
        const n = { ...N, [t.code]: N[t.code] + 1 };
        let amt = t.fixed;
        if (t.kind === 'jackpot') amt = J / n.jackpot;
        else if (n.jackpot === 0 && share.includes(t.code)) {
          const live = share.filter((x) => n[x] > 0);
          const dead = share.filter((x) => n[x] === 0).reduce((s, x) => s + S[x], 0);
          amt += ((S[t.code] + dead / live.length) * J) / n[t.code];
        }
        e += t.p * tax(amt);
      }
      tot += e;
    }
    expect(Math.abs(exact - tot / B) / exact).toBeLessThan(0.03);
  });

  it('Kỳ vọng giảm khi số vé tăng; điểm hoà vốn làm kỳ vọng = giá vé', () => {
    const a = splitDrawEV(LOTTO535, 16e9, 0.8e6, S).returnRatio;
    const b = splitDrawEV(LOTTO535, 16e9, 3e6, S).returnRatio;
    expect(a).toBeGreaterThan(1);
    expect(b).toBeLessThan(1);
    const be = breakEvenTickets(LOTTO535, 16e9, S)!;
    expect(be).toBeGreaterThan(1.4e6);
    expect(be).toBeLessThan(2.1e6);
    expect(splitDrawEV(LOTTO535, 16e9, be, S).expectedPrize).toBeCloseTo(10000, 0);
  });

  it('Ước lượng số vé từ số người trúng (MLE Poisson) phục hồi T thật', () => {
    const p = new Map(tierProbabilities(LOTTO535).map((t) => [t.tier.code, rToNumber(t.probability)]));
    const T = 1_200_000;
    const winners = { second: Math.round(T * p.get('second')!), third: Math.round(T * p.get('third')!), fourth: Math.round(T * p.get('fourth')!), fifth: Math.round(T * p.get('fifth')!) };
    const est = estimateTickets(LOTTO535, winners)!;
    expect(Math.abs(est.tickets - T) / T).toBeLessThan(0.01);
    expect(est.low).toBeLessThan(T);
    expect(est.high).toBeGreaterThan(T);
    expect(estimateTickets(LOTTO535, {})).toBeNull();
  });
});
