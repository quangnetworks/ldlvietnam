/**
 * SPLIT DRAW ENGINE — kỳ "Chia giải Độc đắc" (Lotto 5/35).
 *
 * Thể lệ (theo thông tin Vietlott công bố trên báo chí, 2025–2026): khi Độc đắc vượt 12 tỷ mà chưa có người trúng,
 * kỳ quay 21:00 ngày hôm sau là kỳ chia giải. Nếu kỳ đó không có vé trúng Độc đắc, TOÀN BỘ giá trị Độc đắc được chia cho
 * các hạng Nhất…Năm theo tỷ lệ (Nhất 2/6, Nhì–Năm mỗi hạng 1/6); trong mỗi hạng chia đều theo số vé trúng và CỘNG THÊM
 * vào giải cố định; hạng không có người trúng thì phần của hạng đó chia đều cho các hạng còn lại.
 *
 * Hệ quả toán học: ở kỳ này toàn bộ Độc đắc chắc chắn được trả cho người chơi của chính kỳ đó, nên mỗi vé nhận thêm
 * xấp xỉ J / T (J = Độc đắc, T = tổng số lần dự thưởng). Khi T đủ nhỏ, kỳ vọng mỗi vé VƯỢT giá vé — tình huống duy nhất
 * xổ số có kỳ vọng dương. Số người trúng khác ở mỗi hạng ~ Poisson(T·p_hạng); tính kỳ vọng chính xác theo mô hình này
 * (kể cả thuế TNCN 10% trên phần vượt 10 triệu, khả năng có người trúng Độc đắc, hạng trống được chia lại).
 */
import type { GameRules } from '../shared/game';
import { rToNumber } from './combinatorics';
import { logGamma } from './distributions';
import { tierProbabilities } from './probability';

/** Tỷ lệ chia Độc đắc theo mã hạng (tổng = 1). */
export type SplitShares = Record<string, number>;

/** Lotto 5/35: Nhất 2/6, Nhì–Năm mỗi hạng 1/6, Khuyến khích không tham gia. */
export const LOTTO535_SPLIT_SHARES: SplitShares = { first: 2 / 6, second: 1 / 6, third: 1 / 6, fourth: 1 / 6, fifth: 1 / 6 };

export const TAX_THRESHOLD = 10_000_000;
export const TAX_RATE = 0.1;

export interface SplitTierEV {
  code: string;
  name: string;
  probability: number;
  /** Số vé trúng hạng này của NGƯỜI KHÁC kỳ vọng (λ = T·p). */
  expectedOtherWinners: number;
  /** Tiền nhận kỳ vọng (sau thuế nếu bật) NẾU vé của bạn trúng hạng này. */
  expectedAmountIfWin: number;
  contribution: number;
}

export interface SplitEvaluation {
  jackpot: number;
  tickets: number;
  expectedPrize: number;
  returnRatio: number;
  /** Xác suất kỳ quay thực sự chia giải (không ai khác trúng Độc đắc). */
  pSplitHappens: number;
  tiers: SplitTierEV[];
}

export function validateShares(rules: GameRules, shares: SplitShares): string | null {
  const sum = Object.values(shares).reduce((s, x) => s + x, 0);
  if (Math.abs(sum - 1) > 1e-6) return 'Tổng tỷ lệ chia phải bằng 1';
  for (const [code, v] of Object.entries(shares)) {
    const t = rules.prizeTiers.find((x) => x.code === code);
    if (!t || t.kind !== 'fixed') return `Hạng ${code} không phải hạng giải cố định của game`;
    if (!(v >= 0)) return 'Tỷ lệ chia không hợp lệ';
  }
  return null;
}

const tax = (a: number, apply: boolean) => (!apply || a <= TAX_THRESHOLD ? a : a - TAX_RATE * (a - TAX_THRESHOLD));

function logPois(k: number, lambda: number): number {
  return -lambda + k * Math.log(lambda) - logGamma(k + 1);
}

/** E[1/(1+N)] với N ~ Poisson(λ) (dạng đóng). */
function meanInvOnePlus(lambda: number): number {
  return lambda < 1e-12 ? 1 : -Math.expm1(-lambda) / lambda;
}

/**
 * E[ tax(f + S/(1+N)) ], N ~ Poisson(λ). Phần thuế chỉ khác 0 khi f + S/(1+N) > 10 triệu, tức N < N*;
 * chỉ cộng dồn hiệu chỉnh trên miền đó (vài trăm số hạng tối đa) nên rất nhanh kể cả khi λ lớn.
 */
function expectedTaxed(f: number, S: number, lambda: number, applyTax: boolean): number {
  const linear = f + S * meanInvOnePlus(lambda);
  if (!applyTax || f + S <= TAX_THRESHOLD) return linear;
  // N* = số N lớn nhất còn chịu thuế.
  const nStar = f >= TAX_THRESHOLD ? Infinity : Math.floor(S / (TAX_THRESHOLD - f) - 1 - 1e-12);
  const sd = Math.sqrt(Math.max(lambda, 1));
  const lo = Math.max(0, Math.floor(lambda - 12 * sd - 30));
  const hi = Math.min(nStar, Math.ceil(lambda + 12 * sd + 30));
  let corr = 0;
  for (let k = lo; k <= hi; k++) {
    const p = lambda < 1e-12 ? (k === 0 ? 1 : 0) : Math.exp(logPois(k, lambda));
    const a = f + S / (1 + k);
    if (a > TAX_THRESHOLD) corr += p * TAX_RATE * (a - TAX_THRESHOLD);
  }
  return linear - corr;
}

/** Kỳ vọng tiền thưởng của MỘT vé (giá cơ bản) ở kỳ chia giải với Độc đắc J và T lần dự thưởng. */
export function splitDrawEV(rules: GameRules, jackpot: number, tickets: number, shares: SplitShares, applyTax = true): SplitEvaluation {
  const tps = tierProbabilities(rules);
  const p = new Map(tps.map((t) => [t.tier.code, rToNumber(t.probability)]));
  const jp = rules.prizeTiers.find((t) => t.kind === 'jackpot');
  const lam = (code: string) => tickets * (p.get(code) ?? 0);
  const lamJ = jp ? lam(jp.code) : 0;
  const pSplit = Math.exp(-lamJ);
  const shareTiers = Object.keys(shares).filter((c) => (p.get(c) ?? 0) > 0);
  const tiers: SplitTierEV[] = [];
  let ev = 0;
  for (const tp of tps) {
    const t = tp.tier;
    const pt = p.get(t.code)!;
    let amount: number;
    if (t.kind === 'jackpot') {
      amount = expectedTaxed(0, jackpot, lam(t.code), applyTax);
    } else if (shareTiers.includes(t.code)) {
      // Có người khác trúng Độc đắc ⇒ không chia, chỉ nhận giải cố định.
      let withSplit = 0;
      const others = shareTiers.filter((c) => c !== t.code);
      // Duyệt mọi tập hạng khác KHÔNG có người trúng (hạng của bạn luôn có người trúng: chính bạn).
      for (let mask = 0; mask < 1 << others.length; mask++) {
        let prob = 1;
        let dead = 0;
        let live = 1;
        others.forEach((c, i) => {
          const pEmpty = Math.exp(-lam(c));
          if (mask & (1 << i)) {
            prob *= pEmpty;
            dead += shares[c];
          } else {
            prob *= 1 - pEmpty;
            live++;
          }
        });
        if (prob < 1e-15) continue;
        const share = shares[t.code] + dead / live;
        withSplit += prob * expectedTaxed(t.amount, share * jackpot, lam(t.code), applyTax);
      }
      amount = pSplit * withSplit + (1 - pSplit) * tax(t.amount, applyTax);
    } else {
      amount = tax(t.amount, applyTax);
    }
    const contribution = pt * amount;
    ev += contribution;
    tiers.push({ code: t.code, name: t.name, probability: pt, expectedOtherWinners: lam(t.code), expectedAmountIfWin: amount, contribution });
  }
  return { jackpot, tickets, expectedPrize: ev, returnRatio: ev / rules.ticketPrice, pSplitHappens: pSplit, tiers };
}

/** Số lần dự thưởng T để kỳ vọng/vé = giá vé (kỳ vọng giảm dần theo T). null nếu không tồn tại trong [1e3, 1e9]. */
export function breakEvenTickets(rules: GameRules, jackpot: number, shares: SplitShares, applyTax = true): number | null {
  const f = (T: number) => splitDrawEV(rules, jackpot, T, shares, applyTax).expectedPrize - rules.ticketPrice;
  let lo = 1e3;
  let hi = 1e9;
  if (f(lo) < 0) return null;
  if (f(hi) > 0) return null;
  for (let i = 0; i < 60; i++) {
    const m = Math.sqrt(lo * hi);
    if (f(m) > 0) lo = m;
    else hi = m;
  }
  return Math.round(Math.sqrt(lo * hi));
}

export interface TicketEstimate {
  tickets: number;
  low: number;
  high: number;
  winnersUsed: number;
}

/**
 * Ước lượng hợp lý cực đại số lần dự thưởng T từ số vé trúng từng hạng của một kỳ đã quay:
 * số vé trúng hạng i ~ Poisson(T·p_i) ⇒ T̂ = Σ nᵢ / Σ pᵢ; khoảng tin cậy 95% theo Σ nᵢ ~ Poisson.
 */
export function estimateTickets(rules: GameRules, winners: Record<string, number>): TicketEstimate | null {
  const p = new Map(tierProbabilities(rules).map((t) => [t.tier.code, rToNumber(t.probability)]));
  let n = 0;
  let sp = 0;
  for (const [code, count] of Object.entries(winners)) {
    const pi = p.get(code);
    if (pi == null || !Number.isFinite(count) || count < 0) continue;
    n += count;
    sp += pi;
  }
  if (n <= 0 || sp <= 0) return null;
  const se = 1.96 * Math.sqrt(n);
  return { tickets: Math.round(n / sp), low: Math.round(Math.max(0, n - se) / sp), high: Math.round((n + se) / sp), winnersUsed: n };
}
