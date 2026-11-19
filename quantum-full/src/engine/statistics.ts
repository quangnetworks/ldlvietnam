/**
 * Q2 — STATISTICAL ENGINE
 * Thống kê mô tả và kiểm định trên dữ liệu lịch sử. Mọi chỉ số đi kèm cỡ mẫu và giá trị kỳ vọng
 * dưới giả thuyết H0 "mỗi tổ hợp đồng khả năng". Không suy diễn "số nóng" có xác suất tương lai cao hơn.
 */
import type { GameRules } from '../shared/game';
import { mainPoolSize } from '../shared/game';
import { combination, rToNumber } from './combinatorics';
import { hypergeometric } from './probability';

import { benjaminiHochberg, chiSquareSurvival, poissonUpperTail, twoSidedP } from './distributions';
import type { DrawRecord } from './types';

export const STAT_DISCLAIMER =
  'Tần suất quá khứ mô tả dữ liệu đã xảy ra. Với kỳ quay ngẫu nhiên độc lập, số xuất hiện nhiều ("nóng") hay ít ("lạnh") KHÔNG có xác suất xuất hiện cao hơn ở kỳ tiếp theo.';

export interface SampleInfo {
  draws: number;
  firstDrawAt: string | null;
  lastDrawAt: string | null;
  /** Đánh giá độ tin cậy dựa trên số quan sát kỳ vọng mỗi ô. */
  reliability: 'insufficient' | 'low' | 'moderate' | 'good';
  note: string;
}

export function sampleInfo(rules: GameRules, draws: DrawRecord[]): SampleInfo {
  const n = draws.length;
  const expectedPerNumber = (n * rules.mainPicks) / mainPoolSize(rules);
  let reliability: SampleInfo['reliability'];
  let note: string;
  if (n === 0) {
    reliability = 'insufficient';
    note = 'Chưa có dữ liệu. Hãy import kết quả quay tại Data Center.';
  } else if (expectedPerNumber < 5) {
    reliability = 'insufficient';
    note = `Kỳ vọng mỗi số chỉ ${expectedPerNumber.toFixed(1)} lần (< 5) — kiểm định χ² không đáng tin cậy.`;
  } else if (expectedPerNumber < 20) {
    reliability = 'low';
    note = `Kỳ vọng mỗi số ${expectedPerNumber.toFixed(1)} lần — độ biến động ngẫu nhiên còn rất lớn.`;
  } else if (expectedPerNumber < 100) {
    reliability = 'moderate';
    note = `Kỳ vọng mỗi số ${expectedPerNumber.toFixed(1)} lần — đủ cho kiểm định tổng thể, chưa đủ cho kết luận từng số.`;
  } else {
    reliability = 'good';
    note = `Kỳ vọng mỗi số ${expectedPerNumber.toFixed(1)} lần.`;
  }
  return { draws: n, firstDrawAt: draws[0]?.drawAt ?? null, lastDrawAt: draws[n - 1]?.drawAt ?? null, reliability, note };
}

export interface NumberFrequency {
  number: number;
  count: number;
  relative: number;
  expected: number;
  /** (O − E)/√(n·p·(1−p)) */
  zScore: number;
  lastSeenAgo: number | null;
}

export interface ChiSquareResult {
  statistic: number;
  /** Thống kê đã hiệu chỉnh cho việc rút không hoàn lại K số/kỳ: X²·(N−1)/(N−K). */
  adjustedStatistic: number;
  df: number;
  pValue: number;
  conclusion: string;
}

export interface FrequencyResult {
  sample: SampleInfo;
  numbers: NumberFrequency[];
  /** Phương sai quan sát của số lần xuất hiện giữa các số so với phương sai lý thuyết n·p·(1−p). */
  variance: { observed: number; expected: number; observedSd: number; expectedSd: number };
  chiSquare: ChiSquareResult;
  special: { pool: [number, number]; numbers: { number: number; count: number; expected: number }[]; chiSquare: ChiSquareResult } | null;
  disclaimer: string;
}

function chiConclusion(p: number): string {
  if (p < 0.001) return 'Bác bỏ H0 ở mức 0,1% — cần kiểm tra chất lượng dữ liệu trước khi diễn giải.';
  if (p < 0.05) return 'Bác bỏ H0 ở mức 5% — có thể do ngẫu nhiên (đa kiểm định) hoặc lỗi dữ liệu; chưa đủ để kết luận có quy luật.';
  return 'Không bác bỏ H0: phân bố tần suất phù hợp với quay ngẫu nhiên đồng đều.';
}

export function frequencyAnalysis(rules: GameRules, draws: DrawRecord[]): FrequencyResult {
  const N = mainPoolSize(rules);
  const K = rules.mainPicks;
  const n = draws.length;
  const p = K / N;
  const counts = new Array<number>(N).fill(0);
  const lastSeen = new Array<number | null>(N).fill(null);
  draws.forEach((d, idx) => {
    for (const x of d.main) {
      counts[x - rules.mainMin]++;
      lastSeen[x - rules.mainMin] = idx;
    }
  });
  const expected = n * p;
  const sdExp = Math.sqrt(n * p * (1 - p));
  const numbers: NumberFrequency[] = counts.map((c, i) => ({
    number: rules.mainMin + i,
    count: c,
    relative: n > 0 ? c / n : 0,
    expected,
    zScore: sdExp > 0 ? (c - expected) / sdExp : 0,
    lastSeenAgo: lastSeen[i] === null ? null : n - 1 - (lastSeen[i] as number),
  }));
  const mean = counts.reduce((s, c) => s + c, 0) / N;
  const obsVar = counts.reduce((s, c) => s + (c - mean) ** 2, 0) / (N - 1);
  const x2 = expected > 0 ? counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0) : 0;
  // Var(O_i) = n·p·(1−p) ⇒ E[X²] = N·(1−p) = N − K; hiệu chỉnh để xấp xỉ χ²(N−1).
  const adj = (x2 * (N - 1)) / (N - K);
  const pv = n > 0 ? chiSquareSurvival(adj, N - 1) : 1;
  let special: FrequencyResult['special'] = null;
  if (rules.specialMode !== 'none') {
    const sMin = rules.specialMode === 'separate_pool' ? (rules.specialMin as number) : rules.mainMin;
    const sMax = rules.specialMode === 'separate_pool' ? (rules.specialMax as number) : rules.mainMax;
    const S = sMax - sMin + 1;
    const sc = new Array<number>(S).fill(0);
    let ns = 0;
    for (const d of draws) {
      if (d.special != null) {
        sc[d.special - sMin]++;
        ns++;
      }
    }
    // separate_pool: mỗi số đặc biệt có xác suất 1/S. bonus_from_main: biên duyên mỗi số = 1/N.
    const e = ns / S;
    const sx2 = e > 0 ? sc.reduce((s, c) => s + (c - e) ** 2 / e, 0) : 0;
    const spv = ns > 0 ? chiSquareSurvival(sx2, S - 1) : 1;
    special = {
      pool: [sMin, sMax],
      numbers: sc.map((c, i) => ({ number: sMin + i, count: c, expected: e })),
      chiSquare: { statistic: sx2, adjustedStatistic: sx2, df: S - 1, pValue: spv, conclusion: chiConclusion(spv) },
    };
  }
  return {
    sample: sampleInfo(rules, draws),
    numbers,
    variance: { observed: obsVar, expected: n * p * (1 - p), observedSd: Math.sqrt(obsVar), expectedSd: sdExp },
    chiSquare: { statistic: x2, adjustedStatistic: adj, df: N - 1, pValue: pv, conclusion: chiConclusion(pv) },
    special,
    disclaimer: STAT_DISCLAIMER,
  };
}

/** Phân phối chính xác của tổng K số chọn từ [min, max] (đếm tổ hợp bằng quy hoạch động). */
export function exactSumDistribution(rules: GameRules): Map<number, number> {
  const N = mainPoolSize(rules);
  const K = rules.mainPicks;
  const maxSum = K * rules.mainMax;
  // dp[j][s] = số cách chọn j số có tổng s
  let dp: number[][] = Array.from({ length: K + 1 }, () => new Array<number>(maxSum + 1).fill(0));
  dp[0][0] = 1;
  for (let x = rules.mainMin; x < rules.mainMin + N; x++) {
    const next = dp.map((r) => r.slice());
    for (let j = 0; j < K; j++) {
      for (let s = 0; s + x <= maxSum; s++) {
        if (dp[j][s]) next[j + 1][s + x] += dp[j][s];
      }
    }
    dp = next;
  }
  const out = new Map<number, number>();
  const total = combination(N, K);
  dp[K].forEach((c, s) => {
    if (c) out.set(s, c / total);
  });
  return out;
}

export interface CategoryComparison {
  label: string;
  observed: number;
  expected: number;
  observedShare: number;
  expectedShare: number;
}

export interface DistributionResult {
  sample: SampleInfo;
  oddEven: { categories: CategoryComparison[]; chiSquare: ChiSquareResult };
  lowHigh: { lowMax: number; categories: CategoryComparison[]; chiSquare: ChiSquareResult };
  sum: {
    observedMean: number;
    expectedMean: number;
    expectedSd: number;
    zMean: number;
    pValueMean: number;
    histogram: { from: number; to: number; observed: number; expected: number }[];
  };
  consecutive: { drawsWithConsecutive: number; observedShare: number; expectedShare: number; zScore: number; pValue: number };
  gaps: { number: number; currentGap: number | null; maxGap: number; meanGap: number | null }[];
  expectedMeanGap: number;
  disclaimer: string;
}

function categoryChi(categories: CategoryComparison[]): ChiSquareResult {
  const valid = categories.filter((c) => c.expected > 0);
  const x2 = valid.reduce((s, c) => s + (c.observed - c.expected) ** 2 / c.expected, 0);
  const df = Math.max(1, valid.length - 1);
  const total = valid.reduce((s, c) => s + c.observed, 0);
  const pv = total > 0 ? chiSquareSurvival(x2, df) : 1;
  return { statistic: x2, adjustedStatistic: x2, df, pValue: pv, conclusion: chiConclusion(pv) };
}

/** Kỳ vọng phân phối "số lượng phần tử thuộc tập A (cỡ m) trong K số quay" = siêu bội. */
function hyperCategories(N: number, K: number, m: number, n: number, observedCounts: number[], label: (k: number) => string): CategoryComparison[] {
  const out: CategoryComparison[] = [];
  for (let k = 0; k <= K; k++) {
    const p = rToNumber(hypergeometric(N, m, K, k));
    out.push({ label: label(k), observed: observedCounts[k] ?? 0, expected: n * p, observedShare: n ? (observedCounts[k] ?? 0) / n : 0, expectedShare: p });
  }
  return out;
}

export function distributionAnalysis(rules: GameRules, draws: DrawRecord[], sumBins = 12): DistributionResult {
  const N = mainPoolSize(rules);
  const K = rules.mainPicks;
  const n = draws.length;
  let oddInPool = 0;
  for (let x = rules.mainMin; x <= rules.mainMax; x++) if (x % 2 === 1) oddInPool++;
  const lowMax = Math.floor((rules.mainMin + rules.mainMax) / 2);
  const lowInPool = lowMax - rules.mainMin + 1;
  const oddCounts = new Array<number>(K + 1).fill(0);
  const lowCounts = new Array<number>(K + 1).fill(0);
  const sums: number[] = [];
  let withConsecutive = 0;
  for (const d of draws) {
    const sorted = [...d.main].sort((a, b) => a - b);
    oddCounts[sorted.filter((x) => x % 2 === 1).length]++;
    lowCounts[sorted.filter((x) => x <= lowMax).length]++;
    sums.push(sorted.reduce((s, x) => s + x, 0));
    if (sorted.some((x, i) => i > 0 && x - sorted[i - 1] === 1)) withConsecutive++;
  }
  const oddCats = hyperCategories(N, K, oddInPool, n, oddCounts, (k) => `${k} lẻ / ${K - k} chẵn`);
  const lowCats = hyperCategories(N, K, lowInPool, n, lowCounts, (k) => `${k} thấp / ${K - k} cao`);

  const expectedMean = (K * (rules.mainMin + rules.mainMax)) / 2;
  const expectedVar = ((K * (N * N - 1)) / 12) * ((N - K) / (N - 1));
  const expectedSd = Math.sqrt(expectedVar);
  const observedMean = n ? sums.reduce((s, x) => s + x, 0) / n : 0;
  const zMean = n ? (observedMean - expectedMean) / (expectedSd / Math.sqrt(n)) : 0;
  const exact = exactSumDistribution(rules);
  const minSum = (K * (2 * rules.mainMin + K - 1)) / 2;
  const maxSum = (K * (2 * rules.mainMax - K + 1)) / 2;
  const width = Math.ceil((maxSum - minSum + 1) / sumBins);
  const histogram: DistributionResult['sum']['histogram'] = [];
  for (let b = 0; b < sumBins; b++) {
    const from = minSum + b * width;
    const to = Math.min(maxSum, from + width - 1);
    if (from > maxSum) break;
    let pe = 0;
    for (let s = from; s <= to; s++) pe += exact.get(s) ?? 0;
    histogram.push({ from, to, observed: sums.filter((s) => s >= from && s <= to).length, expected: n * pe });
  }

  const pNoConsec = combination(N - K + 1, K) / combination(N, K);
  const pConsec = 1 - pNoConsec;
  const zC = n ? (withConsecutive - n * pConsec) / Math.sqrt(n * pConsec * (1 - pConsec)) : 0;

  // Khoảng cách (gap): số kỳ giữa hai lần xuất hiện liên tiếp của cùng một số.
  const gaps: DistributionResult['gaps'] = [];
  for (let x = rules.mainMin; x <= rules.mainMax; x++) {
    let last: number | null = null;
    const g: number[] = [];
    draws.forEach((d, i) => {
      if (d.main.includes(x)) {
        if (last !== null) g.push(i - last);
        last = i;
      }
    });
    gaps.push({
      number: x,
      currentGap: last === null ? null : n - 1 - last,
      maxGap: g.length ? Math.max(...g) : 0,
      meanGap: g.length ? g.reduce((s, v) => s + v, 0) / g.length : null,
    });
  }

  return {
    sample: sampleInfo(rules, draws),
    oddEven: { categories: oddCats, chiSquare: categoryChi(oddCats) },
    lowHigh: { lowMax, categories: lowCats, chiSquare: categoryChi(lowCats) },
    sum: { observedMean, expectedMean, expectedSd, zMean, pValueMean: n ? twoSidedP(zMean) : 1, histogram },
    consecutive: {
      drawsWithConsecutive: withConsecutive,
      observedShare: n ? withConsecutive / n : 0,
      expectedShare: pConsec,
      zScore: zC,
      pValue: n ? twoSidedP(zC) : 1,
    },
    gaps,
    expectedMeanGap: N / K,
    disclaimer: STAT_DISCLAIMER,
  };
}

export interface ComboFrequency {
  numbers: number[];
  count: number;
  expected: number;
  pValue: number;
  qValue: number;
}

export interface ComboResult {
  sample: SampleInfo;
  size: number;
  totalCombos: number;
  expectedPerCombo: number;
  observedDistinct: number;
  top: ComboFrequency[];
  significantAfterFdr: number;
  note: string;
}

/** Tần suất cặp (size=2) hoặc bộ ba (size=3) với hiệu chỉnh đa kiểm định Benjamini–Hochberg. */
export function comboFrequency(rules: GameRules, draws: DrawRecord[], size: 2 | 3, top = 30): ComboResult {
  const N = mainPoolSize(rules);
  const K = rules.mainPicks;
  const n = draws.length;
  const counts = new Map<string, number>();
  for (const d of draws) {
    const s = [...d.main].sort((a, b) => a - b);
    if (size === 2) {
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
        const k = `${s[i]}-${s[j]}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    } else {
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) for (let l = j + 1; l < s.length; l++) {
        const k = `${s[i]}-${s[j]}-${s[l]}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  }
  const totalCombos = combination(N, size);
  // P(một cặp/bộ ba cụ thể nằm trong kỳ quay) = C(N−size, K−size)/C(N, K)
  const pc = combination(N - size, K - size) / combination(N, K);
  const expected = n * pc;
  const entries = [...counts.entries()];
  const pvals = entries.map(([, c]) => poissonUpperTail(c, expected));
  // Các tổ hợp chưa xuất hiện có p = 1; đưa vào để BH dùng đúng số giả thuyết m.
  const allP = pvals.concat(new Array<number>(Math.max(0, totalCombos - entries.length)).fill(1));
  const q = benjaminiHochberg(allP);
  const rows: ComboFrequency[] = entries.map(([k, c], i) => ({ numbers: k.split('-').map(Number), count: c, expected, pValue: pvals[i], qValue: q[i] }));
  rows.sort((a, b) => b.count - a.count || a.pValue - b.pValue);
  const significant = rows.filter((r) => r.qValue < 0.05).length;
  return {
    sample: sampleInfo(rules, draws),
    size,
    totalCombos,
    expectedPerCombo: expected,
    observedDistinct: entries.length,
    top: rows.slice(0, top),
    significantAfterFdr: significant,
    note:
      significant === 0
        ? `Không có ${size === 2 ? 'cặp' : 'bộ ba'} nào lệch có ý nghĩa sau hiệu chỉnh đa kiểm định (FDR 5%, m=${totalCombos}).`
        : `${significant} tổ hợp lệch có ý nghĩa sau FDR 5% — cần kiểm tra dữ liệu và kiểm định lại trên dữ liệu mới (out-of-sample).`,
  };
}

export interface RollingWindowResult {
  window: number;
  drawsUsed: number;
  expected: number;
  numbers: { number: number; count: number; zScore: number }[];
}

export function rollingWindows(rules: GameRules, draws: DrawRecord[], windows = [30, 60, 100]): RollingWindowResult[] {
  const N = mainPoolSize(rules);
  const p = rules.mainPicks / N;
  return windows.map((w) => {
    const slice = draws.slice(Math.max(0, draws.length - w));
    const m = slice.length;
    const counts = new Array<number>(N).fill(0);
    for (const d of slice) for (const x of d.main) counts[x - rules.mainMin]++;
    const e = m * p;
    const sd = Math.sqrt(m * p * (1 - p));
    return { window: w, drawsUsed: m, expected: e, numbers: counts.map((c, i) => ({ number: rules.mainMin + i, count: c, zScore: sd ? (c - e) / sd : 0 })) };
  });
}

/** Trend theo thời gian: tổng các số mỗi kỳ (phục vụ biểu đồ). */
export function sumSeries(draws: DrawRecord[]): { drawCode: string; drawAt: string; sum: number }[] {
  return draws.map((d) => ({ drawCode: d.drawCode, drawAt: d.drawAt, sum: d.main.reduce((s, x) => s + x, 0) }));
}

