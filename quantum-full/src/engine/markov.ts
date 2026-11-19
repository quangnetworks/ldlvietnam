/**
 * Q4 — MARKOV ENGINE
 * Kiểm định sự phụ thuộc chuỗi giữa các kỳ quay. KHÔNG mặc định chuỗi có tính Markov:
 * mọi chỉ số đều được so sánh với giả thuyết H0 "các kỳ độc lập".
 */
import type { GameRules } from '../shared/game';
import { mainPoolSize } from '../shared/game';
import { rToNumber } from './combinatorics';
import { benjaminiHochberg, chiSquareSurvival, twoSidedP } from './distributions';
import { hypergeometric } from './probability';
import type { DrawRecord } from './types';

export interface TransitionTable {
  n00: number;
  n01: number;
  n10: number;
  n11: number;
}

function chi2x2(t: TransitionTable): { statistic: number; pValue: number } {
  const total = t.n00 + t.n01 + t.n10 + t.n11;
  if (total === 0) return { statistic: 0, pValue: 1 };
  const r0 = t.n00 + t.n01;
  const r1 = t.n10 + t.n11;
  const c0 = t.n00 + t.n10;
  const c1 = t.n01 + t.n11;
  if (!r0 || !r1 || !c0 || !c1) return { statistic: 0, pValue: 1 };
  const cells: [number, number][] = [
    [t.n00, (r0 * c0) / total],
    [t.n01, (r0 * c1) / total],
    [t.n10, (r1 * c0) / total],
    [t.n11, (r1 * c1) / total],
  ];
  const x2 = cells.reduce((s, [o, e]) => s + (o - e) ** 2 / e, 0);
  return { statistic: x2, pValue: chiSquareSurvival(x2, 1) };
}

function runsTest(series: number[]): number {
  const n1 = series.filter((x) => x === 1).length;
  const n0 = series.length - n1;
  if (n1 === 0 || n0 === 0) return 1;
  let runs = 1;
  for (let i = 1; i < series.length; i++) if (series[i] !== series[i - 1]) runs++;
  const n = n0 + n1;
  const mu = (2 * n0 * n1) / n + 1;
  const varR = ((mu - 1) * (mu - 2)) / (n - 1);
  if (varR <= 0) return 1;
  return twoSidedP((runs - mu) / Math.sqrt(varR));
}

function autocorrelation(x: number[], lag: number): number {
  const n = x.length;
  if (n <= lag + 1) return 0;
  const mean = x.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) den += (x[i] - mean) ** 2;
  for (let i = lag; i < n; i++) num += (x[i] - mean) * (x[i - lag] - mean);
  return den === 0 ? 0 : num / den;
}

export interface MarkovResult {
  draws: number;
  uniformRate: number;
  pooled: TransitionTable & { pRepeat: number; pAfterAbsent: number; statistic: number; pValue: number };
  perNumber: { number: number; pRepeat: number | null; pValue: number; qValue: number; runsPValue: number }[];
  significantAfterFdr: number;
  overlap: { observedMean: number; expectedMean: number; distribution: { k: number; observed: number; expected: number }[]; statistic: number; pValue: number };
  lagCorrelation: { lag: number; meanIndicatorAcf: number; zIndicator: number; sumAcf: number; zSum: number; pSum: number }[];
  conclusion: string;
}

export function markovAnalysis(rules: GameRules, draws: DrawRecord[], maxLag = 10): MarkovResult {
  const N = mainPoolSize(rules);
  const K = rules.mainPicks;
  const n = draws.length;
  const p = K / N;
  const sets = draws.map((d) => new Set(d.main));
  const pooled: TransitionTable = { n00: 0, n01: 0, n10: 0, n11: 0 };
  const series: number[][] = [];
  const per: { number: number; table: TransitionTable; runsPValue: number }[] = [];
  for (let x = rules.mainMin; x <= rules.mainMax; x++) {
    const s = sets.map((set) => (set.has(x) ? 1 : 0));
    series.push(s);
    const t: TransitionTable = { n00: 0, n01: 0, n10: 0, n11: 0 };
    for (let i = 1; i < s.length; i++) {
      const key = `n${s[i - 1]}${s[i]}` as keyof TransitionTable;
      t[key]++;
      pooled[key]++;
    }
    per.push({ number: x, table: t, runsPValue: runsTest(s) });
  }
  const pooledChi = chi2x2(pooled);
  const perP = per.map((r) => chi2x2(r.table).pValue);
  const perQ = benjaminiHochberg(perP);

  // Số lượng số trùng giữa hai kỳ liên tiếp — dưới H0 tuân theo siêu bội HG(N, K, K).
  const overlapCounts = new Array<number>(K + 1).fill(0);
  for (let i = 1; i < n; i++) {
    let c = 0;
    for (const x of draws[i].main) if (sets[i - 1].has(x)) c++;
    overlapCounts[c]++;
  }
  const pairsN = Math.max(0, n - 1);
  const dist = overlapCounts.map((o, k) => ({ k, observed: o, expected: pairsN * rToNumber(hypergeometric(N, K, K, k)) }));
  // Gộp các ô có kỳ vọng < 5 vào ô cuối để χ² hợp lệ.
  const merged: { o: number; e: number }[] = [];
  let accO = 0;
  let accE = 0;
  for (const d of dist) {
    accO += d.observed;
    accE += d.expected;
    if (accE >= 5) {
      merged.push({ o: accO, e: accE });
      accO = 0;
      accE = 0;
    }
  }
  if (accE > 0 && merged.length) {
    merged[merged.length - 1].o += accO;
    merged[merged.length - 1].e += accE;
  }
  const ox2 = merged.reduce((s, m) => s + (m.o - m.e) ** 2 / m.e, 0);
  const odf = Math.max(1, merged.length - 1);
  const overlapP = merged.length > 1 ? chiSquareSurvival(ox2, odf) : 1;
  const observedOverlapMean = pairsN ? overlapCounts.reduce((s, o, k) => s + o * k, 0) / pairsN : 0;

  const sums = draws.map((d) => d.main.reduce((s, v) => s + v, 0));
  const lagCorrelation: MarkovResult['lagCorrelation'] = [];
  for (let lag = 1; lag <= Math.min(maxLag, Math.max(0, n - 2)); lag++) {
    const acfs = series.map((s) => autocorrelation(s, lag));
    const meanAcf = acfs.reduce((s, v) => s + v, 0) / acfs.length;
    const sumAcf = autocorrelation(sums, lag);
    // SE xấp xỉ: ACF mẫu ~ N(0, 1/n) dưới H0; trung bình của N chuỗi (gần độc lập) có SE ≈ 1/√(N·n).
    const zInd = meanAcf * Math.sqrt(N * n);
    const zSum = sumAcf * Math.sqrt(n);
    lagCorrelation.push({ lag, meanIndicatorAcf: meanAcf, zIndicator: zInd, sumAcf, zSum, pSum: twoSidedP(zSum) });
  }
  const sig = perQ.filter((q) => q < 0.05).length;
  const pRepeat = pooled.n10 + pooled.n11 ? pooled.n11 / (pooled.n10 + pooled.n11) : 0;
  const pAfterAbsent = pooled.n00 + pooled.n01 ? pooled.n01 / (pooled.n00 + pooled.n01) : 0;
  const dependent = pooledChi.pValue < 0.01 || overlapP < 0.01;
  return {
    draws: n,
    uniformRate: p,
    pooled: { ...pooled, pRepeat, pAfterAbsent, statistic: pooledChi.statistic, pValue: pooledChi.pValue },
    perNumber: per.map((r, i) => ({
      number: r.number,
      pRepeat: r.table.n10 + r.table.n11 ? r.table.n11 / (r.table.n10 + r.table.n11) : null,
      pValue: perP[i],
      qValue: perQ[i],
      runsPValue: r.runsPValue,
    })),
    significantAfterFdr: sig,
    overlap: { observedMean: observedOverlapMean, expectedMean: (K * K) / N, distribution: dist, statistic: ox2, pValue: overlapP },
    lagCorrelation,
    conclusion:
      n < 30
        ? 'Dữ liệu quá ít (< 30 kỳ) để kiểm định phụ thuộc chuỗi.'
        : dependent
          ? 'Phát hiện lệch khỏi H0 độc lập ở mức 1%. Trước khi diễn giải, kiểm tra lỗi dữ liệu (trùng kỳ, sai thứ tự) và xác nhận trên dữ liệu mới.'
          : 'Không bác bỏ giả thuyết độc lập giữa các kỳ: không có bằng chứng cho cấu trúc Markov khai thác được.',
  };
}
