/**
 * Q1 — PROBABILITY ENGINE
 * Xác suất chính xác theo phân phối siêu bội (hypergeometric) cho từng hạng giải, kỳ vọng (EV),
 * xác suất có ít nhất một vé trúng, xác suất qua nhiều kỳ quay độc lập.
 */
import type { GameRules, PrizeTier } from '../shared/game';
import { mainPoolSize, specialPoolSize } from '../shared/game';
import {
  combinationBig,
  rational,
  rAdd,
  rMul,
  rSub,
  rToNumber,
  rOneIn,
  R0,
  R1,
  type Rational,
} from './combinatorics';

/** P(trùng đúng k số) khi chọn K số từ N, kết quả quay K số: C(K,k)·C(N−K,K−k)/C(N,K). */
export function hypergeometric(N: number, K: number, n: number, k: number): Rational {
  // N: kích thước tổng thể, K: số "thành công" trong tổng thể, n: số lần rút, k: số thành công quan sát.
  if (k < 0 || k > n || k > K || n - k > N - K) return R0;
  return rational(combinationBig(K, k) * combinationBig(N - K, n - k), combinationBig(N, n));
}

/** Xác suất trùng k số chính cho một vé (vé chọn K số, kỳ quay ra K số chính). */
export function mainMatchProbability(rules: GameRules, k: number): Rational {
  const N = mainPoolSize(rules);
  const K = rules.mainPicks;
  return hypergeometric(N, K, K, k);
}

/** Xác suất số đặc biệt "trùng" với vé, điều kiện đã trùng k số chính. */
export function specialMatchProbability(rules: GameRules, k: number): Rational {
  switch (rules.specialMode) {
    case 'none':
      return R0;
    case 'separate_pool':
      return rational(1n, BigInt(specialPoolSize(rules)));
    case 'bonus_from_main': {
      // Số đặc biệt được quay từ N−K số chính còn lại. Vé còn K−k số không trùng số chính,
      // tất cả đều nằm trong N−K số còn lại ⇒ P = (K−k)/(N−K).
      const N = mainPoolSize(rules);
      const K = rules.mainPicks;
      return rational(BigInt(K - k), BigInt(N - K));
    }
  }
}

/** Ô kết quả của một vé: (số trùng chính, trùng đặc biệt?). */
export interface OutcomeCell {
  mainMatches: number;
  specialMatched: boolean;
  probability: Rational;
}

export function outcomeCells(rules: GameRules): OutcomeCell[] {
  const cells: OutcomeCell[] = [];
  for (let k = 0; k <= rules.mainPicks; k++) {
    const pk = mainMatchProbability(rules, k);
    if (rules.specialMode === 'none') {
      cells.push({ mainMatches: k, specialMatched: false, probability: pk });
      continue;
    }
    const ps = specialMatchProbability(rules, k);
    cells.push({ mainMatches: k, specialMatched: true, probability: rMul(pk, ps) });
    cells.push({ mainMatches: k, specialMatched: false, probability: rMul(pk, rSub(R1, ps)) });
  }
  return cells;
}

/** Hạng giải mà một ô kết quả thuộc về. Hạng được ưu tiên theo thứ tự cấu hình (hạng đầu tiên khớp). */
export function tierForOutcome(rules: GameRules, mainMatches: number, specialMatched: boolean): PrizeTier | null {
  for (const t of rules.prizeTiers) {
    if (t.mainMatches !== mainMatches) continue;
    if (t.specialMatch === null || t.specialMatch === specialMatched) return t;
  }
  return null;
}

export interface TierProbability {
  tier: PrizeTier;
  probability: Rational;
  probabilityValue: number;
  oneIn: number;
}

export function tierProbabilities(rules: GameRules): TierProbability[] {
  const acc = new Map<string, Rational>();
  for (const t of rules.prizeTiers) acc.set(t.code, R0);
  for (const c of outcomeCells(rules)) {
    const t = tierForOutcome(rules, c.mainMatches, c.specialMatched);
    if (t) acc.set(t.code, rAdd(acc.get(t.code)!, c.probability));
  }
  return rules.prizeTiers.map((tier) => {
    const p = acc.get(tier.code)!;
    return { tier, probability: p, probabilityValue: rToNumber(p), oneIn: rOneIn(p) };
  });
}

/** Tổng số kết quả có thể (không gian mẫu từ góc nhìn một vé). */
export function totalOutcomes(rules: GameRules): bigint {
  const main = combinationBig(mainPoolSize(rules), rules.mainPicks);
  if (rules.specialMode === 'separate_pool') return main * BigInt(specialPoolSize(rules));
  return main;
}

/** Xác suất Jackpot (hạng có kind=jackpot cao nhất – hạng jackpot đầu tiên trong cấu hình). */
export function jackpotProbability(rules: GameRules): Rational {
  const jp = rules.prizeTiers.find((t) => t.kind === 'jackpot');
  if (!jp) return R0;
  return tierProbabilities(rules).find((x) => x.tier.code === jp.code)!.probability;
}

export function anyPrizeProbability(rules: GameRules): Rational {
  return tierProbabilities(rules).reduce((s, x) => rAdd(s, x.probability), R0);
}

export interface ExpectedValue {
  /** Kỳ vọng tiền thưởng / vé (VND), chưa trừ giá vé, chưa tính thuế, jackpot tính theo giá trị tối thiểu. */
  expectedPrize: number;
  expectedPrizeFixedOnly: number;
  ticketPrice: number;
  /** EV ròng = expectedPrize − ticketPrice. */
  expectedNet: number;
  /** Tỷ lệ hoàn vốn kỳ vọng = expectedPrize / ticketPrice. */
  returnRatio: number;
  notes: string[];
}

export function expectedValue(rules: GameRules, jackpotOverride?: Record<string, number>): ExpectedValue {
  let ev = R0;
  let evFixed = R0;
  const notes: string[] = [];
  for (const tp of tierProbabilities(rules)) {
    const amount = jackpotOverride?.[tp.tier.code] ?? tp.tier.amount;
    const contrib = rMul(tp.probability, rational(BigInt(amount), 1n));
    ev = rAdd(ev, contrib);
    if (tp.tier.kind === 'fixed') evFixed = rAdd(evFixed, contrib);
  }
  if (rules.prizeTiers.some((t) => t.kind === 'jackpot')) {
    notes.push('Giải Jackpot tính theo giá trị tham chiếu (mặc định: mức khởi điểm tối thiểu); giá trị thực tế biến động.');
  }
  if (rules.prizeTiers.some((t) => t.shared)) {
    notes.push('Hạng giải có cơ chế chia giải: nếu nhiều người cùng trúng, giá trị thực nhận giảm.');
  }
  notes.push('Chưa trừ thuế thu nhập cá nhân đối với phần thưởng vượt ngưỡng chịu thuế.');
  const expectedPrize = rToNumber(ev);
  return {
    expectedPrize,
    expectedPrizeFixedOnly: rToNumber(evFixed),
    ticketPrice: rules.ticketPrice,
    expectedNet: expectedPrize - rules.ticketPrice,
    returnRatio: expectedPrize / rules.ticketPrice,
    notes,
  };
}

/**
 * Xác suất có ít nhất một vé trúng Jackpot trong một kỳ khi mua T vé KHÁC NHAU:
 * các biến cố trúng Jackpot của các tổ hợp khác nhau là xung khắc ⇒ P = T·p (chính xác).
 */
export function jackpotProbabilityForDistinctTickets(rules: GameRules, ticketCount: number): Rational {
  if (ticketCount < 0) throw new RangeError('ticketCount phải ≥ 0');
  const p = jackpotProbability(rules);
  const r = rMul(p, rational(BigInt(ticketCount), 1n));
  return r.num > r.den ? R1 : r;
}

/** P(ít nhất một lần thành công) qua n phép thử độc lập với xác suất p: 1 − (1 − p)^n (chính xác). */
export function atLeastOneAcrossIndependent(p: Rational, n: number): Rational {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('n phải là số nguyên không âm');
  if (n > 5000) {
    // Tránh phân số khổng lồ: dùng log1p ổn định số học.
    const pv = rToNumber(p);
    const v = -Math.expm1(n * Math.log1p(-pv));
    return { num: BigInt(Math.round(v * 1e15)), den: 10n ** 15n };
  }
  let q = R1;
  const notP = rSub(R1, p);
  for (let i = 0; i < n; i++) q = rMul(q, notP);
  return rSub(R1, q);
}

/** Xấp xỉ P(ít nhất một vé trúng giải bất kỳ) khi mua T vé, giả định độc lập (dùng cho vé ngẫu nhiên). */
export function anyPrizeAtLeastOneApprox(rules: GameRules, ticketCount: number): number {
  const p = rToNumber(anyPrizeProbability(rules));
  return -Math.expm1(ticketCount * Math.log1p(-p));
}

export interface ProbabilitySummary {
  totalOutcomes: string;
  jackpot: { probability: number; oneIn: number; exact: string };
  anyPrize: { probability: number; oneIn: number };
  tiers: { code: string; name: string; mainMatches: number; specialMatch: boolean | null; kind: string; amount: number; probability: number; oneIn: number; exact: string }[];
  expectedValue: ExpectedValue;
}

export function probabilitySummary(rules: GameRules): ProbabilitySummary {
  const tiers = tierProbabilities(rules);
  const jp = jackpotProbability(rules);
  const any = anyPrizeProbability(rules);
  return {
    totalOutcomes: totalOutcomes(rules).toString(),
    jackpot: { probability: rToNumber(jp), oneIn: rOneIn(jp), exact: `${jp.num}/${jp.den}` },
    anyPrize: { probability: rToNumber(any), oneIn: rOneIn(any) },
    tiers: tiers.map((t) => ({
      code: t.tier.code,
      name: t.tier.name,
      mainMatches: t.tier.mainMatches,
      specialMatch: t.tier.specialMatch,
      kind: t.tier.kind,
      amount: t.tier.amount,
      probability: t.probabilityValue,
      oneIn: t.oneIn,
      exact: `${t.probability.num}/${t.probability.den}`,
    })),
    expectedValue: expectedValue(rules),
  };
}
