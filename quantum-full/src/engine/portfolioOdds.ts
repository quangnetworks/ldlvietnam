/**
 * PORTFOLIO ODDS — xác suất CHÍNH XÁC của cả danh mục vé trong một kỳ quay.
 *
 * Các vé trong cùng một kỳ KHÔNG độc lập (cùng một kết quả quay), nên xác suất "có ít nhất 1 vé trúng" phụ thuộc
 * cách phối hợp vé. Với game nhỏ (C(N,K) ≤ EXACT_LIMIT, vd Lotto 5/35: 324.632 tổ hợp × 12 số đặc biệt) ta liệt kê
 * TOÀN BỘ không gian kết quả bằng bitmask; game lớn (Power 6/55) dùng Monte Carlo có seed.
 *
 * Bất biến: tiền thưởng kỳ vọng của danh mục = tổng kỳ vọng từng vé (tuyến tính của kỳ vọng) — tối ưu phối hợp vé
 * chỉ thay đổi HÌNH DẠNG phân phối (trúng đều hơn), không làm tăng kỳ vọng.
 */
import type { GameRules } from '../shared/game';
import { mainPoolSize, specialPoolSize } from '../shared/game';
import { combination, rToNumber } from './combinatorics';
import { wilsonInterval } from './distributions';
import { simulateDraw } from './montecarlo';
import { evaluateTicket } from './prize';
import { anyPrizeProbability, tierForOutcome } from './probability';
import { createRng } from './rng';
import type { Ticket } from './types';

export const EXACT_LIMIT = 600_000;
export const ODDS_MAX_TICKETS = 50;
export const ODDS_MC_MAX_WORK = 2_000_000;

export interface OddsBucket {
  code: 'zero' | 'below_cost' | 'break_even' | 'ten_x';
  label: string;
  probability: number;
}

export interface PortfolioOdds {
  method: 'exact' | 'monte_carlo';
  /** Số kết quả đã liệt kê (exact) hoặc số kỳ mô phỏng (monte_carlo). */
  outcomes: number;
  ticketCount: number;
  cost: number;
  pAnyPrize: number;
  /** Cùng số vé nhưng chọn ngẫu nhiên độc lập: 1 − (1 − p)^n. */
  pAnyPrizeIndependent: number;
  pBreakEven: number;
  pTenX: number;
  expectedPayout: number;
  returnRatio: number;
  buckets: OddsBucket[];
  /** Chỉ với monte_carlo: khoảng tin cậy 95% của pAnyPrize. */
  ci95: { low: number; high: number } | null;
  jackpotsUsed: Record<string, number>;
  notes: string[];
}

function popcount32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function amountTable(rules: GameRules, jackpots: Record<string, number>, special: boolean): number[] {
  return Array.from({ length: rules.mainPicks + 1 }, (_, k) => {
    const t = tierForOutcome(rules, k, special);
    if (!t) return 0;
    return t.kind === 'jackpot' ? (jackpots[t.code] ?? t.amount) : t.amount;
  });
}

class Acc {
  any = 0;
  be = 0;
  ten = 0;
  below = 0;
  ev = 0;
  w = 0;
  constructor(private cost: number) {}
  add(payout: number, weight: number) {
    this.w += weight;
    this.ev += payout * weight;
    if (payout > 0) this.any += weight;
    if (payout >= this.cost) this.be += weight;
    else if (payout > 0) this.below += weight;
    if (payout >= 10 * this.cost) this.ten += weight;
  }
  /** Trọng số là số đếm nguyên (chính xác); chia một lần ở cuối để tránh cộng dồn sai số. */
  normalize() {
    for (const k of ['any', 'be', 'ten', 'below', 'ev'] as const) this[k] /= this.w;
    this.w = 1;
  }
}

function exactOdds(rules: GameRules, tickets: Ticket[], jackpots: Record<string, number>, acc: Acc): number {
  const N = mainPoolSize(rules);
  const K = rules.mainPicks;
  const n = tickets.length;
  const lo = new Int32Array(n);
  const hi = new Int32Array(n);
  tickets.forEach((t, i) => {
    for (const x of t.main) {
      const b = x - rules.mainMin;
      if (b < 32) lo[i] |= 1 << b;
      else hi[i] |= 1 << (b - 32);
    }
  });
  const noSp = amountTable(rules, jackpots, false);
  const withSp = amountTable(rules, jackpots, true);
  const separate = rules.specialMode === 'separate_pool';
  const S = separate ? specialPoolSize(rules) : 1;
  // Nhóm vé theo số đặc biệt đã chọn.
  const groups = new Map<number, number[]>();
  if (separate) tickets.forEach((t, i) => groups.set(t.special as number, [...(groups.get(t.special as number) ?? []), i]));
  const groupList = [...groups.values()];
  const others = S - groupList.length;
  const idx = Array.from({ length: K }, (_, i) => i);
  const m = new Int32Array(n);
  let count = 0;
  for (;;) {
    let clo = 0;
    let chi = 0;
    for (const b of idx) {
      if (b < 32) clo |= 1 << b;
      else chi |= 1 << (b - 32);
    }
    let base = 0;
    for (let t = 0; t < n; t++) {
      m[t] = popcount32(clo & lo[t]) + popcount32(chi & hi[t]);
      base += noSp[m[t]];
    }
    if (!separate) acc.add(base, 1);
    else {
      for (const g of groupList) {
        let p = base;
        for (const t of g) p += withSp[m[t]] - noSp[m[t]];
        acc.add(p, 1);
      }
      if (others > 0) acc.add(base, others);
    }
    count++;
    // Tổ hợp kế tiếp theo thứ tự từ điển.
    let i = K - 1;
    while (i >= 0 && idx[i] === N - K + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < K; j++) idx[j] = idx[j - 1] + 1;
  }
  return count * (separate ? S : 1);
}

function monteCarloOdds(rules: GameRules, tickets: Ticket[], jackpots: Record<string, number>, acc: Acc, seed: string): number {
  const B = Math.max(10_000, Math.min(200_000, Math.floor(ODDS_MC_MAX_WORK / tickets.length)));
  const rng = createRng(seed);
  for (let b = 0; b < B; b++) {
    const d = simulateDraw(rules, rng);
    let p = 0;
    for (const t of tickets) {
      const e = evaluateTicket(rules, t, d.main, d.special);
      if (e.tier) p += e.tier.kind === 'jackpot' ? (jackpots[e.tier.code] ?? e.tier.amount) : e.tier.amount;
    }
    acc.add(p, 1);
  }
  return B;
}

export function portfolioOdds(rules: GameRules, tickets: Ticket[], jackpots: Record<string, number> = {}, seed = 'portfolio-odds'): PortfolioOdds {
  if (!tickets.length) throw new RangeError('Danh mục rỗng');
  if (tickets.length > ODDS_MAX_TICKETS) throw new RangeError(`Tối đa ${ODDS_MAX_TICKETS} vé`);
  const cost = tickets.length * rules.ticketPrice;
  const acc = new Acc(cost);
  const exact = combination(mainPoolSize(rules), rules.mainPicks) <= EXACT_LIMIT && mainPoolSize(rules) <= 64;
  const outcomes = exact ? exactOdds(rules, tickets, jackpots, acc) : monteCarloOdds(rules, tickets, jackpots, acc, seed);
  acc.normalize();
  const p1 = rToNumber(anyPrizeProbability(rules));
  const jackpotsUsed = Object.fromEntries(rules.prizeTiers.filter((t) => t.kind === 'jackpot').map((t) => [t.code, jackpots[t.code] ?? t.amount]));
  const notes = [
    'Tiền thưởng trước thuế TNCN; Jackpot tính theo giá trị hiện tại đã nhập (hoặc mức tối thiểu) và chưa tính rủi ro chia giải.',
    'Giá trị kỳ vọng của danh mục luôn bằng tổng kỳ vọng từng vé — phối hợp vé chỉ thay đổi khả năng "có vé trúng", không tăng kỳ vọng.',
  ];
  if (!exact) notes.push('Game có quá nhiều tổ hợp để liệt kê; kết quả là ước lượng Monte Carlo có seed cố định (tái lập được).');
  const ci = exact ? null : wilsonInterval(Math.round(acc.any * outcomes), outcomes);
  return {
    method: exact ? 'exact' : 'monte_carlo',
    outcomes,
    ticketCount: tickets.length,
    cost,
    pAnyPrize: acc.any,
    pAnyPrizeIndependent: 1 - (1 - p1) ** tickets.length,
    pBreakEven: acc.be,
    pTenX: acc.ten,
    expectedPayout: acc.ev,
    returnRatio: acc.ev / cost,
    buckets: [
      { code: 'zero', label: 'Không trúng gì', probability: Math.max(0, 1 - acc.any) },
      { code: 'below_cost', label: 'Trúng nhưng chưa hoàn vốn', probability: acc.below },
      { code: 'break_even', label: 'Hoàn vốn trở lên (< 10 lần chi phí)', probability: acc.be - acc.ten },
      { code: 'ten_x', label: 'Từ 10 lần chi phí trở lên', probability: acc.ten },
    ],
    ci95: ci ? { low: ci.low, high: ci.high } : null,
    jackpotsUsed,
    notes,
  };
}
