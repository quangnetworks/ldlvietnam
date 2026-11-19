/**
 * Q3 — BAYESIAN ENGINE
 * - Beta–Binomial cho xác suất mỗi số xuất hiện trong một kỳ: θᵢ ~ Beta(s·p₀, s·(1−p₀)), p₀ = K/N.
 *   Prior được neo tại giá trị lý thuyết đồng đều p₀ (không dùng prior tuỳ tiện để tạo lợi thế giả);
 *   s là "độ mạnh prior" (số kỳ quan sát giả định).
 * - Dirichlet–Multinomial cho tỷ trọng các số (đối xứng α).
 * - Độ nhạy prior: so sánh posterior dưới nhiều mức s.
 */
import type { GameRules } from '../shared/game';
import { mainPoolSize } from '../shared/game';
import { betaQuantile } from './distributions';
import type { DrawRecord } from './types';
import { sampleDirichlet, type Rng } from './rng';

export interface BetaPosterior {
  number: number;
  count: number;
  alpha: number;
  beta: number;
  mean: number;
  low: number;
  high: number;
  /** Khoảng tin cậy có chứa giá trị lý thuyết p₀ hay không. */
  containsUniform: boolean;
}

export interface BayesianResult {
  draws: number;
  priorStrength: number;
  uniformRate: number;
  credibleLevel: number;
  posteriors: BetaPosterior[];
  /** Số khoảng tin cậy KHÔNG chứa p₀ và số kỳ vọng do ngẫu nhiên (N·(1−level)). */
  excludingUniform: number;
  expectedExcludingByChance: number;
  sensitivity: { priorStrength: number; minMean: number; maxMean: number; spread: number }[];
  dirichlet: { alpha: number; posteriorMeans: { number: number; mean: number }[] };
  interpretation: string;
}

export function countsOf(rules: GameRules, draws: DrawRecord[]): number[] {
  const counts = new Array<number>(mainPoolSize(rules)).fill(0);
  for (const d of draws) for (const x of d.main) counts[x - rules.mainMin]++;
  return counts;
}

export function betaPosteriors(rules: GameRules, draws: DrawRecord[], priorStrength: number, level = 0.95): BetaPosterior[] {
  const N = mainPoolSize(rules);
  const p0 = rules.mainPicks / N;
  const n = draws.length;
  const a0 = priorStrength * p0;
  const b0 = priorStrength * (1 - p0);
  const tail = (1 - level) / 2;
  return countsOf(rules, draws).map((c, i) => {
    const a = a0 + c;
    const b = b0 + (n - c);
    const low = betaQuantile(tail, a, b);
    const high = betaQuantile(1 - tail, a, b);
    return { number: rules.mainMin + i, count: c, alpha: a, beta: b, mean: a / (a + b), low, high, containsUniform: low <= p0 && p0 <= high };
  });
}

/** Xác suất dự báo mỗi số xuất hiện ở kỳ kế tiếp (posterior predictive mean). */
export function bayesianPredictive(rules: GameRules, draws: DrawRecord[], priorStrength: number): number[] {
  const N = mainPoolSize(rules);
  const p0 = rules.mainPicks / N;
  const n = draws.length;
  return countsOf(rules, draws).map((c) => (priorStrength * p0 + c) / (priorStrength + n));
}

/** Trọng số Thompson sampling: lấy mẫu tỷ trọng từ Dirichlet posterior. */
export function dirichletThompsonWeights(rules: GameRules, draws: DrawRecord[], alpha: number, rng: Rng): number[] {
  const counts = countsOf(rules, draws);
  return sampleDirichlet(rng, counts.map((c) => alpha + c));
}

export function bayesianAnalysis(rules: GameRules, draws: DrawRecord[], priorStrength = 100, level = 0.95, dirichletAlpha = 1): BayesianResult {
  const N = mainPoolSize(rules);
  const p0 = rules.mainPicks / N;
  const posteriors = betaPosteriors(rules, draws, priorStrength, level);
  const excluding = posteriors.filter((p) => !p.containsUniform).length;
  const sensitivity = [1, 10, 100, 1000].map((s) => {
    const means = bayesianPredictive(rules, draws, s);
    const minMean = Math.min(...means);
    const maxMean = Math.max(...means);
    return { priorStrength: s, minMean, maxMean, spread: maxMean - minMean };
  });
  const counts = countsOf(rules, draws);
  const totalAlpha = dirichletAlpha * N + draws.length * rules.mainPicks;
  const expectedByChance = N * (1 - level);
  return {
    draws: draws.length,
    priorStrength,
    uniformRate: p0,
    credibleLevel: level,
    posteriors,
    excludingUniform: excluding,
    expectedExcludingByChance: expectedByChance,
    sensitivity,
    dirichlet: { alpha: dirichletAlpha, posteriorMeans: counts.map((c, i) => ({ number: rules.mainMin + i, mean: (dirichletAlpha + c) / totalAlpha })) },
    interpretation:
      draws.length === 0
        ? 'Chưa có dữ liệu: posterior trùng prior đồng đều.'
        : excluding <= Math.ceil(expectedByChance * 2)
          ? `${excluding}/${N} khoảng tin cậy không chứa p₀ = ${p0.toFixed(4)} (kỳ vọng ngẫu nhiên ≈ ${expectedByChance.toFixed(1)}). Không có bằng chứng Bayes cho số "lệch" khỏi đồng đều.`
          : `${excluding}/${N} khoảng tin cậy không chứa p₀ (kỳ vọng ngẫu nhiên ≈ ${expectedByChance.toFixed(1)}). Cần kiểm tra chất lượng dữ liệu và kiểm định ngoài mẫu (backtest) trước khi diễn giải.`,
  };
}

/** Brier score & log loss của một vector xác suất dự báo cho một kỳ quay. */
export function scoreProbabilities(rules: GameRules, probs: number[], actualMain: number[]): { brier: number; logLoss: number } {
  const set = new Set(actualMain);
  let brier = 0;
  let ll = 0;
  probs.forEach((p, i) => {
    const y = set.has(rules.mainMin + i) ? 1 : 0;
    const q = Math.min(1 - 1e-12, Math.max(1e-12, p));
    brier += (q - y) ** 2;
    ll += -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
  });
  return { brier: brier / probs.length, logLoss: ll / probs.length };
}
