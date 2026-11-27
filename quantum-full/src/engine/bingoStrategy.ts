/**
 * BINGO18 — CHIẾN THUẬT KIỂM SOÁT LỖ.
 *
 * 1) Chứng minh: không tổ hợp cược nào lãi chắc chắn. Với mọi cách chia tiền x giữa các cửa,
 *    lãi/lỗ tệ nhất ≤ kỳ vọng = Σ xᵢ·EVᵢ ≤ max EVᵢ < 0. Ta tính cả hai đầu:
 *    - cận trên (không tổ hợp nào bảo đảm hơn): kỳ vọng ròng của cửa tốt nhất;
 *    - cận dưới: tổ hợp phòng thủ tốt nhất tìm được (rải các cửa "Chọn số", "Hai số trùng", "Ba số trùng bất kỳ")
 *      và mức lỗ CHẮC CHẮN của nó, liệt kê đủ 216 kết quả.
 * 2) Mô phỏng các chiến thuật tăng giảm tiền cược (cược đều, gấp thếp, Paroli) với cùng một quy tắc dừng:
 *    lỗ tối đa = ngân sách (bảo đảm thật duy nhất), chốt lời (tuỳ chọn), số kỳ tối đa.
 */
import { BINGO_FACES, BINGO_STAKE, OFFICIAL_PAYTABLE, allOutcomes, analyzeBet, betLabel, payout, validateBet, type BingoBet, type BingoPayTable } from './bingo18';
import { createRng } from './rng';

export function allBets(): BingoBet[] {
  return [
    ...BINGO_FACES.map((v) => ({ type: 'single' as const, value: v })),
    ...BINGO_FACES.map((v) => ({ type: 'pair' as const, value: v })),
    ...BINGO_FACES.map((v) => ({ type: 'triple' as const, value: v })),
    { type: 'any_triple' },
    ...Array.from({ length: 16 }, (_, i) => ({ type: 'sum' as const, value: i + 3 })),
    { type: 'big' },
    { type: 'small' },
    { type: 'draw' },
  ];
}

export interface HedgeResult {
  betsConsidered: number;
  outcomes: number;
  /** Không tổ hợp nào bảo đảm hơn mức này (VND ròng / 10.000đ cược): kỳ vọng của cửa tốt nhất. */
  upperBound: number;
  bestBet: { label: string; net: number; returnRatio: number };
  /** Tổ hợp phòng thủ tốt nhất tìm được và mức lãi/lỗ CHẮC CHẮN của nó (VND ròng / 10.000đ cược). */
  hedge: { guaranteed: number; mix: { label: string; weight: number }[]; worstOutcome: number[] };
  profitableMixExists: boolean;
}

/** Lãi/lỗ tệ nhất (VND ròng trên mỗi 10.000đ) của một tổ hợp tỷ trọng, liệt kê đủ 216 kết quả. */
export function guaranteedNet(mix: { bet: BingoBet; weight: number }[], table: BingoPayTable = OFFICIAL_PAYTABLE): { net: number; worst: number[] } {
  const total = mix.reduce((s, m) => s + m.weight, 0);
  let worst = Infinity;
  let at: number[] = [];
  for (const o of allOutcomes()) {
    let pay = 0;
    for (const m of mix) pay += (m.weight / total) * payout(m.bet, o, table);
    const net = pay - BINGO_STAKE;
    if (net < worst) {
      worst = net;
      at = [...o];
    }
  }
  return { net: worst, worst: at };
}

export function hedgeBound(table: BingoPayTable = OFFICIAL_PAYTABLE): HedgeResult {
  const bets = allBets();
  const analyses = bets.map((b) => analyzeBet(b, table));
  const best = analyses.reduce((a, b) => (b.expectedPayout > a.expectedPayout ? b : a));
  const singles = BINGO_FACES.map((v) => ({ type: 'single' as const, value: v }));
  const pairs = BINGO_FACES.map((v) => ({ type: 'pair' as const, value: v }));
  // Lưới trên họ tổ hợp ĐỐI XỨNG theo số: α cho 6 cửa Chọn số, β cho 6 cửa Hai số trùng, phần còn lại cho Ba số trùng bất kỳ.
  // Do đối xứng, lãi/lỗ của họ này chỉ phụ thuộc DẠNG kết quả (3 số khác nhau, một cặp, bộ ba) ⇒ tối ưu trên 3 kết quả đại diện,
  // rồi kiểm chứng tổ hợp tốt nhất trên đủ 216 kết quả.
  const reps: [number, number, number][] = [
    [1, 2, 3],
    [1, 1, 2],
    [1, 1, 1],
  ];
  const familyMix = (a: number, b: number) =>
    [...singles.map((bet) => ({ bet, weight: a / 6 })), ...pairs.map((bet) => ({ bet, weight: b / 6 })), { bet: { type: 'any_triple' } as BingoBet, weight: Math.max(0, 1 - a - b) }].filter((m) => m.weight > 1e-12);
  // Tổng tiền thưởng của mỗi nhóm cửa (6 Chọn số, 6 Hai số trùng, Ba số trùng bất kỳ) tại từng dạng kết quả.
  const groupPay = reps.map((o) => ({
    s: singles.reduce((x, bet) => x + payout(bet, o, table), 0) / 6,
    p: pairs.reduce((x, bet) => x + payout(bet, o, table), 0) / 6,
    t: payout({ type: 'any_triple' }, o, table),
  }));
  let bestA = 1;
  let bestB = 0;
  let bestRep = -Infinity;
  const step = 0.0005;
  for (let a = 0.5; a <= 1 + 1e-9; a += step)
    for (let b = 0; a + b <= 1 + 1e-9; b += step) {
      const g = Math.max(0, 1 - a - b);
      let v = Infinity;
      for (const gp of groupPay) v = Math.min(v, a * gp.s + b * gp.p + g * gp.t - BINGO_STAKE);
      if (v > bestRep) [bestRep, bestA, bestB] = [v, a, b];
    }
  const bestMix = familyMix(bestA, bestB);
  const verified = guaranteedNet(bestMix, table);
  const bestNet = verified.net;
  const bestWorst = verified.worst;
  const grouped = new Map<string, number>();
  for (const m of bestMix) {
    const label = m.bet.type === 'single' ? 'Chọn số (mỗi số 1 đến 6)' : m.bet.type === 'pair' ? 'Hai số trùng (mỗi số 1 đến 6)' : betLabel(m.bet);
    grouped.set(label, (grouped.get(label) ?? 0) + m.weight);
  }
  return {
    betsConsidered: bets.length,
    outcomes: 216,
    upperBound: best.expectedPayout - BINGO_STAKE,
    bestBet: { label: best.label, net: best.expectedPayout - BINGO_STAKE, returnRatio: best.returnRatio },
    hedge: { guaranteed: bestNet, mix: [...grouped.entries()].map(([label, weight]) => ({ label, weight })), worstOutcome: bestWorst },
    profitableMixExists: best.expectedPayout >= BINGO_STAKE,
  };
}

// ─────────────────────────── Mô phỏng chiến thuật tăng giảm tiền cược ───────────────────────────

export type StakeStrategy = 'flat' | 'martingale' | 'paroli' | 'flat_no_stop';

export const STAKE_STRATEGIES: Record<StakeStrategy, { name: string; description: string }> = {
  flat: { name: 'Cược đều, có dừng', description: 'Mỗi kỳ cùng một mức; dừng khi chạm lỗ tối đa hoặc đạt chốt lời.' },
  martingale: { name: 'Gấp thếp (Martingale)', description: 'Thua thì gấp đôi mức cược, thắng thì về mức gốc; dừng khi không đủ ngân sách cho lượt kế tiếp.' },
  paroli: { name: 'Gấp khi thắng (Paroli)', description: 'Thắng thì gấp đôi, tối đa 3 lượt liền rồi về mức gốc; thua thì về mức gốc.' },
  flat_no_stop: { name: 'Cược đều, chơi hết số kỳ', description: 'Không chốt lời; chỉ dừng khi hết ngân sách hoặc hết số kỳ.' },
};

export const STRATEGY_SIM_MAX_WORK = 4_000_000;

export interface StrategySimInput {
  bet: BingoBet;
  /** Số lần tham gia (10.000đ) ở mức cược gốc. */
  baseUnits: number;
  /** Lỗ tối đa trong ngày (VND): không bao giờ đặt lượt nào làm tổng lỗ vượt mức này. */
  budget: number;
  /** Dừng khi lãi ròng đạt mức này (VND); null = không chốt lời. */
  takeProfit: number | null;
  maxRounds: number;
  sessions: number;
  /** Giới hạn số lần tham gia của một lượt (giới hạn kênh bán). */
  maxUnits?: number;
  seed: string;
}

export interface StrategySimResult {
  code: StakeStrategy;
  name: string;
  description: string;
  probabilityProfit: number;
  meanNet: number;
  medianNet: number;
  p5: number;
  p95: number;
  worst: number;
  /** Tỷ lệ phiên kết thúc vì chạm lỗ tối đa (hết ngân sách). */
  probabilityHitStop: number;
  probabilityTakeProfit: number;
  meanRounds: number;
  /** Tổng tiền đã đặt trung bình mỗi phiên. */
  meanStaked: number;
}

export function simulateStakeStrategies(input: StrategySimInput, table: BingoPayTable = OFFICIAL_PAYTABLE): StrategySimResult[] {
  const err = validateBet(input.bet);
  if (err) throw new RangeError(err);
  if (!Number.isInteger(input.baseUnits) || input.baseUnits < 1 || input.baseUnits > 100) throw new RangeError('Mức cược gốc phải từ 1 đến 100 lần tham gia');
  if (input.budget < input.baseUnits * BINGO_STAKE) throw new RangeError('Lỗ tối đa phải ít nhất bằng một lượt cược gốc');
  const codes = Object.keys(STAKE_STRATEGIES) as StakeStrategy[];
  const work = input.sessions * input.maxRounds * codes.length;
  if (work > STRATEGY_SIM_MAX_WORK) throw new RangeError(`Khối lượng mô phỏng ${work} vượt giới hạn ${STRATEGY_SIM_MAX_WORK}`);
  const maxUnits = input.maxUnits ?? 100;
  const out: StrategySimResult[] = [];
  for (const code of codes) {
    // Cùng seed cho mọi chiến thuật ⇒ cùng chuỗi kết quả quay, so sánh công bằng.
    const rng = createRng(input.seed);
    const nets: number[] = [];
    let hitStop = 0;
    let hitTp = 0;
    let rounds = 0;
    let staked = 0;
    for (let s = 0; s < input.sessions; s++) {
      let net = 0;
      let units = input.baseUnits;
      let streak = 0;
      let r = 0;
      let reason: 'stop' | 'tp' | 'rounds' = 'rounds';
      for (; r < input.maxRounds; r++) {
        if (code !== 'flat_no_stop' && input.takeProfit != null && net >= input.takeProfit) {
          reason = 'tp';
          break;
        }
        const u = Math.min(units, maxUnits);
        const stake = u * BINGO_STAKE;
        // Bảo đảm cứng: không đặt lượt nào làm tổng lỗ có thể vượt ngân sách.
        if (-net + stake > input.budget) {
          reason = 'stop';
          break;
        }
        const o: [number, number, number] = [rng.int(1, 6), rng.int(1, 6), rng.int(1, 6)];
        const pay = u * payout(input.bet, o, table);
        net += pay - stake;
        staked += stake;
        const won = pay > stake;
        if (code === 'martingale') units = won ? input.baseUnits : u * 2;
        else if (code === 'paroli') {
          streak = won ? streak + 1 : 0;
          units = won && streak < 3 ? u * 2 : input.baseUnits;
          if (streak >= 3) streak = 0;
        }
      }
      if (reason === 'rounds' && code !== 'flat_no_stop' && input.takeProfit != null && net >= input.takeProfit) reason = 'tp';
      if (reason === 'stop') hitStop++;
      if (reason === 'tp') hitTp++;
      rounds += r;
      nets.push(net);
    }
    const sorted = [...nets].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    out.push({
      code,
      ...STAKE_STRATEGIES[code],
      probabilityProfit: nets.filter((v) => v > 0).length / nets.length,
      meanNet: nets.reduce((a, b) => a + b, 0) / nets.length,
      medianNet: q(0.5),
      p5: q(0.05),
      p95: q(0.95),
      worst: sorted[0],
      probabilityHitStop: hitStop / nets.length,
      probabilityTakeProfit: hitTp / nets.length,
      meanRounds: rounds / nets.length,
      meanStaked: staked / nets.length,
    });
  }
  return out;
}
