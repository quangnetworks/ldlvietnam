/**
 * BINGO18 ENGINE — trò chơi trả thưởng cố định với 3 số kết quả, mỗi số từ 1 đến 6 (có thể trùng).
 * Không gian mẫu: 6³ = 216 kết quả đồng khả năng. Mọi xác suất được tính CHÍNH XÁC bằng liệt kê 216 kết quả.
 * Cơ cấu giải (VND cho 1 lần tham gia 10.000đ) theo vietlott.vn/vi/choi/bingo/gioi-thieu-san-pham-bingo18.
 */
import { rational, rToNumber, type Rational } from './combinatorics';
import { chiSquareSurvival, meanInterval, normalCdf, twoSidedP, wilsonInterval } from './distributions';
import { createRng } from './rng';

export const BINGO_FACES = [1, 2, 3, 4, 5, 6] as const;
export const BINGO_STAKE = 10_000;

export type BingoBetType = 'single' | 'pair' | 'triple' | 'any_triple' | 'sum' | 'big' | 'small' | 'draw';

export interface BingoBet {
  type: BingoBetType;
  /** single/pair/triple: số 1–6; sum: tổng 3–18; các loại khác: không dùng. */
  value?: number;
}

export interface BingoPayTable {
  single: [number, number, number]; // xuất hiện 1 / 2 / 3 lần
  pair: number;
  triple: number;
  anyTriple: number;
  sum: Record<number, number>;
  big: number;
  small: number;
  draw: number;
}

/** Cơ cấu giải chính thức (VND / 1 lần tham gia 10.000đ). */
export const OFFICIAL_PAYTABLE: BingoPayTable = {
  single: [12_000, 20_000, 30_000],
  pair: 75_000,
  triple: 1_200_000,
  anyTriple: 200_000,
  sum: { 3: 1_200_000, 4: 400_000, 5: 200_000, 6: 120_000, 7: 80_000, 8: 55_000, 9: 47_000, 10: 44_000, 11: 44_000, 12: 47_000, 13: 55_000, 14: 80_000, 15: 120_000, 16: 200_000, 17: 400_000, 18: 1_200_000 },
  big: 15_000,
  small: 15_000,
  draw: 20_000,
};

export type BingoResult = [number, number, number];

export function allOutcomes(): BingoResult[] {
  const out: BingoResult[] = [];
  for (const a of BINGO_FACES) for (const b of BINGO_FACES) for (const c of BINGO_FACES) out.push([a, b, c]);
  return out;
}

export function isValidResult(r: unknown): r is BingoResult {
  return Array.isArray(r) && r.length === 3 && r.every((x) => Number.isInteger(x) && x >= 1 && x <= 6);
}

export function validateBet(b: BingoBet): string | null {
  switch (b.type) {
    case 'single':
    case 'pair':
    case 'triple':
      return Number.isInteger(b.value) && b.value! >= 1 && b.value! <= 6 ? null : 'Cần chọn số từ 1 đến 6';
    case 'sum':
      return Number.isInteger(b.value) && b.value! >= 3 && b.value! <= 18 ? null : 'Tổng phải từ 3 đến 18';
    default:
      return null;
  }
}

/** Tiền thưởng (VND) cho 1 lần tham gia 10.000đ; 0 nếu không trúng. Mỗi cách chơi chỉ nhận một hạng. */
export function payout(bet: BingoBet, r: BingoResult, table: BingoPayTable = OFFICIAL_PAYTABLE): number {
  const total = r[0] + r[1] + r[2];
  const count = (v: number) => r.filter((x) => x === v).length;
  const triple = r[0] === r[1] && r[1] === r[2];
  switch (bet.type) {
    case 'single': {
      const k = count(bet.value!);
      return k === 0 ? 0 : table.single[k - 1];
    }
    case 'pair':
      return count(bet.value!) >= 2 ? table.pair : 0;
    case 'triple':
      return triple && r[0] === bet.value ? table.triple : 0;
    case 'any_triple':
      return triple ? table.anyTriple : 0;
    case 'sum':
      return total === bet.value ? (table.sum[total] ?? 0) : 0;
    case 'big':
      return total >= 12 ? table.big : 0;
    case 'small':
      return total <= 9 ? table.small : 0;
    case 'draw':
      return total === 10 || total === 11 ? table.draw : 0;
  }
}

export function betLabel(b: BingoBet): string {
  switch (b.type) {
    case 'single':
      return `Chọn số ${b.value}`;
    case 'pair':
      return `Hai số trùng ${b.value}-${b.value}`;
    case 'triple':
      return `Ba số trùng ${b.value}-${b.value}-${b.value}`;
    case 'any_triple':
      return 'Ba số trùng bất kỳ';
    case 'sum':
      return `Tổng ${b.value}`;
    case 'big':
      return 'Lớn (tổng 12 đến 18)';
    case 'small':
      return 'Nhỏ (tổng 3 đến 9)';
    case 'draw':
      return 'Hoà (tổng 10 đến 11)';
  }
}

export interface BetAnalysis {
  bet: BingoBet;
  label: string;
  winProbability: Rational;
  winProbabilityValue: number;
  expectedPayout: number;
  returnRatio: number;
  houseEdge: number;
  maxPayout: number;
}

export function analyzeBet(bet: BingoBet, table: BingoPayTable = OFFICIAL_PAYTABLE): BetAnalysis {
  let wins = 0;
  let total = 0;
  let max = 0;
  for (const o of allOutcomes()) {
    const p = payout(bet, o, table);
    if (p > 0) wins++;
    total += p;
    max = Math.max(max, p);
  }
  const ev = total / 216;
  const wp = rational(BigInt(wins), 216n);
  return { bet, label: betLabel(bet), winProbability: wp, winProbabilityValue: rToNumber(wp), expectedPayout: ev, returnRatio: ev / BINGO_STAKE, houseEdge: 1 - ev / BINGO_STAKE, maxPayout: max };
}

/** Danh mục toàn bộ cược đại diện (đối xứng theo số nên chỉ cần một đại diện cho single/pair/triple). */
export function betCatalog(table: BingoPayTable = OFFICIAL_PAYTABLE): BetAnalysis[] {
  const bets: BingoBet[] = [
    { type: 'single', value: 1 },
    { type: 'pair', value: 1 },
    { type: 'triple', value: 1 },
    { type: 'any_triple' },
    { type: 'big' },
    { type: 'small' },
    { type: 'draw' },
    ...Array.from({ length: 16 }, (_, i) => ({ type: 'sum' as const, value: i + 3 })),
  ];
  return bets.map((b) => analyzeBet(b, table));
}

/** Phân phối chính xác của tổng 3 số: số kết quả / 216. */
export function exactSumCounts(): Record<number, number> {
  const c: Record<number, number> = {};
  for (const o of allOutcomes()) {
    const s = o[0] + o[1] + o[2];
    c[s] = (c[s] ?? 0) + 1;
  }
  return c;
}

// ─────────────────────────── Thống kê lịch sử ───────────────────────────

export interface BingoStats {
  draws: number;
  faces: { face: number; count: number; expected: number; zScore: number }[];
  facesChiSquare: { statistic: number; df: number; pValue: number };
  sums: { sum: number; observed: number; expected: number }[];
  sumsChiSquare: { statistic: number; df: number; pValue: number };
  bigSmallDraw: { label: string; observed: number; expected: number; share: number; expectedShare: number }[];
  triples: { observed: number; expected: number; rate: number; ci95: { low: number; high: number } };
  lag1SumCorrelation: { r: number; z: number; pValue: number };
  bigAfterBigStreak: { streak: number; nextBig: number; total: number; rate: number }[];
  conclusion: string;
}

const LO_HI = (t: number) => (t >= 12 ? 'Lớn' : t <= 9 ? 'Nhỏ' : 'Hoà');

/** Kiểm định tính ngẫu nhiên trên chuỗi kết quả (đã sắp theo thời gian). */
export function bingoStatistics(results: BingoResult[]): BingoStats {
  const n = results.length;
  const faceCounts = [0, 0, 0, 0, 0, 0];
  const sumCounts: Record<number, number> = {};
  const cat: Record<string, number> = { Lớn: 0, Nhỏ: 0, Hoà: 0 };
  let triples = 0;
  const sums: number[] = [];
  for (const r of results) {
    for (const x of r) faceCounts[x - 1]++;
    const t = r[0] + r[1] + r[2];
    sums.push(t);
    sumCounts[t] = (sumCounts[t] ?? 0) + 1;
    cat[LO_HI(t)]++;
    if (r[0] === r[1] && r[1] === r[2]) triples++;
  }
  const eFace = (3 * n) / 6;
  const sdFace = Math.sqrt(3 * n * (1 / 6) * (5 / 6));
  const fx2 = eFace > 0 ? faceCounts.reduce((s, c) => s + (c - eFace) ** 2 / eFace, 0) : 0;
  const exact = exactSumCounts();
  const sumsRows = Array.from({ length: 16 }, (_, i) => i + 3).map((s) => ({ sum: s, observed: sumCounts[s] ?? 0, expected: (n * exact[s]) / 216 }));
  const sx2 = n ? sumsRows.reduce((s, r) => s + (r.observed - r.expected) ** 2 / r.expected, 0) : 0;
  const pCat = { Lớn: 81 / 216, Nhỏ: 81 / 216, Hoà: 54 / 216 };
  // Tự tương quan bậc 1 của tổng.
  let r1 = 0;
  if (n > 2) {
    const m = sums.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) den += (sums[i] - m) ** 2;
    for (let i = 1; i < n; i++) num += (sums[i] - m) * (sums[i - 1] - m);
    r1 = den ? num / den : 0;
  }
  // "Sau k kỳ Lớn liên tiếp, kỳ tiếp theo có Lớn không?" — kiểm tra ngụy biện con bạc.
  const streaks: BingoStats['bigAfterBigStreak'] = [];
  for (const k of [1, 2, 3, 4, 5]) {
    let total = 0;
    let big = 0;
    for (let i = k; i < n; i++) {
      let ok = true;
      for (let j = 1; j <= k; j++) if (LO_HI(sums[i - j]) !== 'Lớn') ok = false;
      if (!ok) continue;
      total++;
      if (LO_HI(sums[i]) === 'Lớn') big++;
    }
    streaks.push({ streak: k, nextBig: big, total, rate: total ? big / total : 0 });
  }
  const fp = n ? chiSquareSurvival(fx2, 5) : 1;
  const sp = n ? chiSquareSurvival(sx2, 15) : 1;
  const z1 = r1 * Math.sqrt(Math.max(1, n));
  const triCi = wilsonInterval(triples, n);
  return {
    draws: n,
    faces: faceCounts.map((c, i) => ({ face: i + 1, count: c, expected: eFace, zScore: sdFace ? (c - eFace) / sdFace : 0 })),
    facesChiSquare: { statistic: fx2, df: 5, pValue: fp },
    sums: sumsRows,
    sumsChiSquare: { statistic: sx2, df: 15, pValue: sp },
    bigSmallDraw: (['Lớn', 'Nhỏ', 'Hoà'] as const).map((l) => ({ label: l, observed: cat[l], expected: n * pCat[l], share: n ? cat[l] / n : 0, expectedShare: pCat[l] })),
    triples: { observed: triples, expected: (n * 6) / 216, rate: n ? triples / n : 0, ci95: { low: triCi.low, high: triCi.high } },
    lag1SumCorrelation: { r: r1, z: z1, pValue: twoSidedP(z1) },
    bigAfterBigStreak: streaks,
    conclusion:
      n < 200
        ? 'Dữ liệu còn ít để kiểm định.'
        : fp < 0.01 || sp < 0.01
          ? 'Có độ lệch đáng chú ý so với ngẫu nhiên đồng đều (mức 1%). Kiểm tra chất lượng dữ liệu trước khi diễn giải; độ lệch nhỏ không bù được tỷ lệ trả thưởng ~55%.'
          : 'Phù hợp với 3 số độc lập, đồng khả năng. Kết quả kỳ trước không ảnh hưởng kỳ sau.',
  };
}

// ─────────────────────────── Mô phỏng phiên chơi ───────────────────────────

export const BINGO_SIM_MAX_WORK = 2_000_000;

export interface SessionSimInput {
  bets: { bet: BingoBet; stakeUnits: number }[];
  drawsPerSession: number;
  sessions: number;
  /** Dừng khi lỗ ròng đạt mức này (VND, > 0) — mặc định không dừng. */
  stopLoss?: number;
  seed: string;
}

export interface SessionSimResult {
  costPerDraw: number;
  expectedNetPerDraw: number;
  sessions: number;
  drawsPerSession: number;
  meanNet: { mean: number; low: number; high: number };
  probabilityProfit: number;
  probabilityLossOverHalf: number;
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  histogram: { from: number; to: number; count: number }[];
  stoppedEarly: number;
}

export function simulateSessions(input: SessionSimInput): SessionSimResult {
  if (!input.bets.length) throw new RangeError('Cần ít nhất 1 cược');
  for (const b of input.bets) {
    const err = validateBet(b.bet);
    if (err) throw new RangeError(err);
    if (!Number.isInteger(b.stakeUnits) || b.stakeUnits < 1 || b.stakeUnits > 100) throw new RangeError('Số lần tham gia mỗi cược phải 1 đến 100');
  }
  const work = input.drawsPerSession * input.sessions * input.bets.length;
  if (work > BINGO_SIM_MAX_WORK) throw new RangeError(`Khối lượng mô phỏng ${work} vượt giới hạn ${BINGO_SIM_MAX_WORK}`);
  const rng = createRng(input.seed);
  const cost = input.bets.reduce((s, b) => s + b.stakeUnits * BINGO_STAKE, 0);
  const evPerDraw = input.bets.reduce((s, b) => s + b.stakeUnits * analyzeBet(b.bet).expectedPayout, 0) - cost;
  const nets: number[] = [];
  let stopped = 0;
  for (let s = 0; s < input.sessions; s++) {
    let net = 0;
    for (let d = 0; d < input.drawsPerSession; d++) {
      if (input.stopLoss && -net >= input.stopLoss) {
        stopped++;
        break;
      }
      const r: BingoResult = [rng.int(1, 6), rng.int(1, 6), rng.int(1, 6)];
      net -= cost;
      for (const b of input.bets) net += b.stakeUnits * payout(b.bet, r);
    }
    nets.push(net);
  }
  const sorted = [...nets].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const bins = 20;
  const width = Math.max(1, Math.ceil((hi - lo + 1) / bins));
  const histogram = Array.from({ length: bins }, (_, i) => ({ from: lo + i * width, to: lo + (i + 1) * width - 1, count: 0 }));
  for (const v of nets) histogram[Math.min(bins - 1, Math.floor((v - lo) / width))].count++;
  const ci = meanInterval(nets);
  const budget = cost * input.drawsPerSession;
  return {
    costPerDraw: cost,
    expectedNetPerDraw: evPerDraw,
    sessions: input.sessions,
    drawsPerSession: input.drawsPerSession,
    meanNet: { mean: ci.mean, low: ci.low, high: ci.high },
    probabilityProfit: nets.filter((v) => v > 0).length / nets.length,
    probabilityLossOverHalf: nets.filter((v) => -v > budget / 2).length / nets.length,
    percentiles: { p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95) },
    histogram: histogram.filter((h) => h.from <= hi),
    stoppedEarly: stopped,
  };
}

// ─────────────────────── MÔ HÌNH DỰ BÁO (WALK-FORWARD) — cùng khung với XSKT ───────────────────────

export type BingoModelCode = 'uniform' | 'hot' | 'cold' | 'bayes' | 'markov' | 'ensemble';

export const BINGO_MODELS: Record<BingoModelCode, { name: string; description: string }> = {
  uniform: { name: 'Đồng đều (baseline)', description: 'Mỗi số 1–6 xác suất 1/6 ở mỗi vị trí.' },
  hot: { name: 'Số nóng', description: 'Tần suất từng số theo vị trí trong W kỳ gần nhất (làm trơn Laplace).' },
  cold: { name: 'Số lạnh', description: 'Ưu tiên số ít xuất hiện trong W kỳ gần nhất (giả thuyết “sắp về”).' },
  bayes: { name: 'Bayes Dirichlet', description: 'Posterior Dirichlet theo toàn bộ lịch sử, prior đồng đều độ mạnh 60.' },
  markov: { name: 'Markov bậc 1', description: 'P(số kỳ này | số cùng vị trí kỳ trước), học từ lịch sử.' },
  ensemble: { name: 'Tổ hợp', description: 'Trung bình xác suất của Nóng, Lạnh, Bayes, Markov.' },
};

export interface BingoModelResult {
  code: BingoModelCode;
  name: string;
  description: string;
  draws: number;
  /** Log-loss trung bình (nats/vị trí); đồng đều = ln 6 ≈ 1,791759. */
  logLoss: number;
  /** Cải thiện so với đồng đều (nats/vị trí; > 0 là tốt hơn). */
  improvement: number;
  z: number;
  pValue: number;
  qValue: number;
  beatsBaseline: boolean;
  /** Cược “Chọn 1 số” theo số mô hình cho là dễ ra nhất: hoàn trả thực tế & tỷ lệ trúng. */
  single: { returnRatio: number; winRate: number };
  /** Cược Lớn hoặc Nhỏ theo mô hình (bên có xác suất cao hơn): hoàn trả thực tế & tỷ lệ trúng. */
  bigSmall: { returnRatio: number; winRate: number };
}

export interface BingoModels {
  window: number;
  warmup: number;
  scoredDraws: number;
  theory: { single: { returnRatio: number; winRate: number }; bigSmall: { returnRatio: number; winRate: number } };
  models: BingoModelResult[];
  verdict: 'insufficient' | 'no_edge' | 'edge';
  headline: string;
  explanation: string[];
}

const LN6 = Math.log(6);

/** Phân phối tổng 3 số từ 3 phân phối vị trí (độc lập) — dùng để quyết định Lớn/Nhỏ. */
function bigSmallProb(p: number[][]): { big: number; small: number } {
  let big = 0;
  let small = 0;
  for (let a = 0; a < 6; a++)
    for (let b = 0; b < 6; b++)
      for (let c = 0; c < 6; c++) {
        const pr = p[0][a] * p[1][b] * p[2][c];
        const t = a + b + c + 3;
        if (t >= 12) big += pr;
        else if (t <= 9) small += pr;
      }
  return { big, small };
}


/**
 * Chấm walk-forward: tại mỗi kỳ i (sau warmup), mô hình chỉ dùng kết quả các kỳ < i để dự báo phân phối 3 vị trí,
 * rồi ghi log-loss và tiền thưởng thực tế của cược mô hình gợi ý. Hiệu chỉnh đa kiểm định Benjamini–Hochberg.
 */
export function bingoModels(results: BingoResult[], opts: { window?: number; warmup?: number; alpha?: number } = {}): BingoModels {
  const W = Math.max(10, opts.window ?? 100);
  const warm = Math.max(W, opts.warmup ?? 200);
  const alpha = opts.alpha ?? 0.05;
  const codes: BingoModelCode[] = ['uniform', 'hot', 'cold', 'bayes', 'markov', 'ensemble'];
  const acc = codes.map(() => ({ sum: 0, sum2: 0, n: 0, ll: 0, sPay: 0, sWin: 0, bPay: 0, bWin: 0 }));
  const all = new Array<number>(18).fill(0); // [vị trí][số]
  const win = new Array<number>(18).fill(0);
  const trans = new Array<number>(108).fill(0); // [vị trí][trước][sau]
  const uni = [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6];
  for (let i = 0; i < results.length; i++) {
    const cur = results[i];
    const prev = i > 0 ? results[i - 1] : null;
    if (i >= warm) {
      const dists: number[][][] = codes.map(() => []);
      for (let pos = 0; pos < 3; pos++) {
        const w = win.slice(pos * 6, pos * 6 + 6);
        const a = all.slice(pos * 6, pos * 6 + 6);
        const ws = w.reduce((s, x) => s + x, 0);
        const as = a.reduce((s, x) => s + x, 0);
        const hot = w.map((x) => (x + 1) / (ws + 6));
        const coldRaw = hot.map((x) => Math.max(0.01, 2 / 6 - x));
        const cs = coldRaw.reduce((s, x) => s + x, 0);
        const cold = coldRaw.map((x) => x / cs);
        const bayes = a.map((x) => (x + 10) / (as + 60));
        let markov = uni;
        if (prev) {
          const row = trans.slice(pos * 36 + (prev[pos] - 1) * 6, pos * 36 + (prev[pos] - 1) * 6 + 6);
          const rs = row.reduce((s, x) => s + x, 0);
          markov = row.map((x) => (x + 1) / (rs + 6));
        }
        const ens = hot.map((_, k) => (hot[k] + cold[k] + bayes[k] + markov[k]) / 4);
        [uni, hot, cold, bayes, markov, ens].forEach((d, m) => dists[m].push(d));
      }
      codes.forEach((_, m) => {
        const d = dists[m];
        let ll = 0;
        for (let pos = 0; pos < 3; pos++) ll += -Math.log(d[pos][cur[pos] - 1]);
        const imp = (3 * LN6 - ll) / 3;
        const A = acc[m];
        A.sum += imp;
        A.sum2 += imp * imp;
        A.n++;
        A.ll += ll;
        // Cược “Chọn 1 số”: số có P(xuất hiện ≥ 1 lần) lớn nhất; baseline chọn số tất định xoay vòng.
        let face: number;
        if (m === 0) face = (i % 6) + 1;
        else {
          const pAny = [0, 1, 2, 3, 4, 5].map((k) => 1 - (1 - d[0][k]) * (1 - d[1][k]) * (1 - d[2][k]));
          face = pAny.indexOf(Math.max(...pAny)) + 1;
        }
        const sp = payout({ type: 'single', value: face }, cur);
        A.sPay += sp;
        if (sp > 0) A.sWin++;
        // Cược Lớn/Nhỏ.
        const bs = m === 0 ? { big: i % 2 ? 1 : 0, small: i % 2 ? 0 : 1 } : bigSmallProb(d);
        const bet: BingoBet = bs.big >= bs.small ? { type: 'big' } : { type: 'small' };
        const bp = payout(bet, cur);
        A.bPay += bp;
        if (bp > 0) A.bWin++;
      });
    }
    // Cập nhật thống kê SAU khi chấm kỳ i (không rò rỉ tương lai).
    for (let pos = 0; pos < 3; pos++) {
      all[pos * 6 + cur[pos] - 1]++;
      win[pos * 6 + cur[pos] - 1]++;
      if (prev) trans[pos * 36 + (prev[pos] - 1) * 6 + (cur[pos] - 1)]++;
    }
    if (i - W >= 0) {
      const old = results[i - W];
      for (let pos = 0; pos < 3; pos++) win[pos * 6 + old[pos] - 1]--;
    }
  }
  const raw = codes.map((code, m) => {
    const A = acc[m];
    const mean = A.n ? A.sum / A.n : 0;
    const sd = A.n > 1 ? Math.sqrt(Math.max(0, A.sum2 / A.n - mean * mean) * (A.n / (A.n - 1))) : 0;
    const z = code === 'uniform' || sd === 0 ? 0 : mean / (sd / Math.sqrt(A.n));
    return {
      code,
      name: BINGO_MODELS[code].name,
      description: BINGO_MODELS[code].description,
      draws: A.n,
      logLoss: A.n ? A.ll / (3 * A.n) : LN6,
      improvement: mean,
      z,
      pValue: code === 'uniform' ? 1 : 1 - normalCdf(z),
      single: { returnRatio: A.n ? A.sPay / (A.n * BINGO_STAKE) : 0, winRate: A.n ? A.sWin / A.n : 0 },
      bigSmall: { returnRatio: A.n ? A.bPay / (A.n * BINGO_STAKE) : 0, winRate: A.n ? A.bWin / A.n : 0 },
    };
  });
  // Benjamini–Hochberg trên 5 mô hình.
  const ps = raw.filter((r) => r.code !== 'uniform').map((r) => r.pValue);
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const q = new Array<number>(ps.length);
  let prevQ = 1;
  for (let r = order.length - 1; r >= 0; r--) {
    prevQ = Math.min(prevQ, (order[r].p * ps.length) / (r + 1));
    q[order[r].i] = Math.min(1, prevQ);
  }
  let k = 0;
  const models: BingoModelResult[] = raw.map((r) => {
    if (r.code === 'uniform') return { ...r, qValue: 1, beatsBaseline: false };
    const qv = q[k++];
    return { ...r, qValue: qv, beatsBaseline: qv < alpha && r.improvement > 0 };
  });
  const single = analyzeBet({ type: 'single', value: 1 });
  const big = analyzeBet({ type: 'big' });
  const theory = { single: { returnRatio: single.returnRatio, winRate: single.winProbabilityValue }, bigSmall: { returnRatio: big.returnRatio, winRate: big.winProbabilityValue } };
  const scored = models[0].draws;
  const fmt = (x: number, d = 2) => x.toLocaleString('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: d });
  if (scored < 500)
    return { window: W, warmup: warm, scoredDraws: scored, theory, models, verdict: 'insufficient', headline: 'CHƯA ĐỦ DỮ LIỆU ĐỂ CHẤM MÔ HÌNH', explanation: [`Mới chấm được ${scored} kỳ; cần ít nhất 500.`] };
  const winners = models.filter((m) => m.beatsBaseline);
  const best = models.filter((m) => m.code !== 'uniform').sort((a, b) => b.improvement - a.improvement)[0];
  const explanation = [
    `Đã chấm ${scored.toLocaleString('vi-VN')} kỳ theo walk-forward: mỗi kỳ chỉ dùng các kỳ trước đó. Thước đo log-loss mỗi vị trí; ngẫu nhiên = ln 6 ≈ 1,7918.`,
    `Mô hình tốt nhất: ${best.name} — log-loss ${fmt(best.logLoss, 5)} (cải thiện ${best.improvement >= 0 ? '+' : ''}${fmt(best.improvement * 1000, 3)}‰, q = ${fmt(best.qValue, 3)}).`,
    `Cược theo mô hình — “Chọn 1 số”: hoàn trả thực tế ${models.map((m) => `${m.name} ${fmt(m.single.returnRatio * 100, 1)}%`).join(' · ')} (lý thuyết ${fmt(theory.single.returnRatio * 100, 2)}%).`,
    `Lớn/Nhỏ theo mô hình: hoàn trả ${models.map((m) => `${m.name} ${fmt(m.bigSmall.returnRatio * 100, 1)}%`).join(' · ')} (lý thuyết ${fmt(theory.bigSmall.returnRatio * 100, 2)}%).`,
  ];
  if (winners.length)
    return { window: W, warmup: warm, scoredDraws: scored, theory, models, verdict: 'edge', headline: 'CÓ MÔ HÌNH VƯỢT NGẪU NHIÊN — CẦN KIỂM CHỨNG TRÊN DỮ LIỆU MỚI', explanation: [...explanation, `Vượt chuẩn: ${winners.map((w) => w.name).join(', ')}. Ngay cả khi vượt, tỷ lệ hoàn trả vẫn phải vượt 100% mới có lời — kiểm tra lỗi dữ liệu và chấm lại trên các kỳ sau hôm nay.`] };
  return { window: W, warmup: warm, scoredDraws: scored, theory, models, verdict: 'no_edge', headline: 'KHÔNG MÔ HÌNH NÀO DỰ BÁO TỐT HƠN CHỌN NGẪU NHIÊN', explanation: [...explanation, 'Vì vậy hệ thống không đưa ra “số dự báo” cho Bingo18: chọn số nào cũng như nhau; chỉ chọn CÁCH CHƠI có hoàn trả cao nhất và giới hạn số lượt.'] };
}
