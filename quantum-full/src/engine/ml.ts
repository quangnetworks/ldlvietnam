/**
 * Q6 — MACHINE LEARNING RESEARCH
 * Khung thử nghiệm dự báo xác suất mỗi số xuất hiện ở kỳ kế tiếp từ đặc trưng chuỗi thời gian.
 * Chia dữ liệu THEO THỜI GIAN (train trước, test sau) — đặc trưng chỉ dùng các kỳ TRƯỚC kỳ cần dự báo.
 * Mọi mô hình được so sánh với baseline Random Uniform p = K/N. Không mặc định ML tốt hơn ngẫu nhiên.
 */
import type { GameRules } from '../shared/game';
import { mainPoolSize } from '../shared/game';
import { meanInterval } from './distributions';
import { createRng, type Rng } from './rng';
import type { DrawRecord } from './types';

export const FEATURE_NAMES = ['tần suất 10 kỳ', 'tần suất 30 kỳ', 'tần suất 100 kỳ', 'khoảng cách từ lần cuối', 'xuất hiện kỳ trước', 'tần suất toàn bộ'] as const;

export interface Dataset {
  X: number[][];
  y: number[];
  /** Chỉ số kỳ (trong mảng draws) mà mỗi dòng dự báo. */
  drawIndex: number[];
}

/** Xây đặc trưng cho kỳ t dựa trên draws[0..t-1] (không rò rỉ dữ liệu tương lai). */
export function featuresForNext(rules: GameRules, history: DrawRecord[]): number[][] {
  const N = mainPoolSize(rules);
  const K = rules.mainPicks;
  const t = history.length;
  const cnt = (w: number) => {
    const c = new Array<number>(N).fill(0);
    for (let i = Math.max(0, t - w); i < t; i++) for (const x of history[i].main) c[x - rules.mainMin]++;
    return c;
  };
  const c10 = cnt(10), c30 = cnt(30), c100 = cnt(100), call = cnt(t);
  const last = new Array<number>(N).fill(-1);
  for (let i = 0; i < t; i++) for (const x of history[i].main) last[x - rules.mainMin] = i;
  const prev = new Set(t ? history[t - 1].main : []);
  const meanGap = N / K;
  return Array.from({ length: N }, (_, i) => [
    c10[i] / Math.min(10, Math.max(1, t)),
    c30[i] / Math.min(30, Math.max(1, t)),
    c100[i] / Math.min(100, Math.max(1, t)),
    Math.min(5, (last[i] < 0 ? t : t - 1 - last[i]) / meanGap),
    prev.has(rules.mainMin + i) ? 1 : 0,
    call[i] / Math.max(1, t),
  ]);
}

export function buildDataset(rules: GameRules, draws: DrawRecord[], minHistory: number): Dataset {
  const X: number[][] = [];
  const y: number[] = [];
  const drawIndex: number[] = [];
  for (let t = minHistory; t < draws.length; t++) {
    const feats = featuresForNext(rules, draws.slice(0, t));
    const actual = new Set(draws[t].main);
    feats.forEach((f, i) => {
      X.push(f);
      y.push(actual.has(rules.mainMin + i) ? 1 : 0);
      drawIndex.push(t);
    });
  }
  return { X, y, drawIndex };
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const clampP = (p: number) => Math.min(1 - 1e-9, Math.max(1e-9, p));

export interface Model {
  predict(x: number[]): number;
}

// ── Logistic Regression (chuẩn hoá đặc trưng, gradient descent, L2) ──
export function trainLogistic(X: number[][], y: number[], opts: { lr?: number; epochs?: number; l2?: number } = {}): Model & { weights: number[]; bias: number; mean: number[]; sd: number[] } {
  const F = X[0]?.length ?? 0;
  const n = X.length;
  const mean = new Array<number>(F).fill(0);
  const sd = new Array<number>(F).fill(0);
  for (const r of X) r.forEach((v, j) => (mean[j] += v / n));
  for (const r of X) r.forEach((v, j) => (sd[j] += (v - mean[j]) ** 2 / n));
  for (let j = 0; j < F; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map((r) => r.map((v, j) => (v - mean[j]) / sd[j]));
  const w = new Array<number>(F).fill(0);
  const pbar = y.reduce((a, b) => a + b, 0) / Math.max(1, n);
  let b = Math.log(clampP(pbar) / (1 - clampP(pbar)));
  const lr = opts.lr ?? 0.5;
  const l2 = opts.l2 ?? 1e-3;
  for (let e = 0; e < (opts.epochs ?? 200); e++) {
    const gw = new Array<number>(F).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < F; j++) z += w[j] * Z[i][j];
      const err = sigmoid(z) - y[i];
      gb += err;
      for (let j = 0; j < F; j++) gw[j] += err * Z[i][j];
    }
    b -= (lr * gb) / n;
    for (let j = 0; j < F; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
  }
  return {
    weights: w,
    bias: b,
    mean,
    sd,
    predict(x) {
      let z = b;
      for (let j = 0; j < F; j++) z += w[j] * ((x[j] - mean[j]) / sd[j]);
      return sigmoid(z);
    },
  };
}

// ── Cây quyết định trên đặc trưng đã chia bin (dùng cho Random Forest & Gradient Boosting) ──
interface Binner {
  edges: number[][];
  bin(x: number[]): number[];
}

function makeBinner(X: number[][], bins = 16): Binner {
  const F = X[0]?.length ?? 0;
  const edges: number[][] = [];
  for (let j = 0; j < F; j++) {
    const col = X.map((r) => r[j]).sort((a, b) => a - b);
    const e: number[] = [];
    for (let q = 1; q < bins; q++) {
      const v = col[Math.floor((q * col.length) / bins)];
      if (e.length === 0 || v > e[e.length - 1]) e.push(v);
    }
    edges.push(e);
  }
  return {
    edges,
    bin: (x) =>
      x.map((v, j) => {
        const e = edges[j];
        let lo = 0;
        let hi = e.length;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (v > e[m]) lo = m + 1;
          else hi = m;
        }
        return lo;
      }),
  };
}

type TreeNode = { leaf: true; value: number } | { leaf: false; feature: number; threshold: number; left: TreeNode; right: TreeNode };

function predictTree(node: TreeNode, b: number[]): number {
  while (!node.leaf) node = b[node.feature] <= node.threshold ? node.left : node.right;
  return node.value;
}

/**
 * Cây hồi quy tối thiểu hoá tổng bình phương sai số (với target 0/1 tương đương Gini).
 * B: dữ liệu đã chia bin; target: giá trị cần khớp; idx: chỉ số mẫu.
 */
function buildTree(B: number[][], target: number[], idx: number[], depth: number, opts: { maxDepth: number; minLeaf: number; mtry: number; nBins: number; rng: Rng; leafValue: (idx: number[]) => number }): TreeNode {
  if (depth >= opts.maxDepth || idx.length < 2 * opts.minLeaf) return { leaf: true, value: opts.leafValue(idx) };
  const F = B[0].length;
  const feats = Array.from({ length: F }, (_, i) => i);
  for (let i = 0; i < opts.mtry; i++) {
    const j = opts.rng.int(i, F - 1);
    [feats[i], feats[j]] = [feats[j], feats[i]];
  }
  let totalS = 0;
  let totalSS = 0;
  for (const i of idx) {
    totalS += target[i];
    totalSS += target[i] * target[i];
  }
  const parentSse = totalSS - (totalS * totalS) / idx.length;
  let best = { gain: 1e-12, feature: -1, threshold: -1 };
  for (const f of feats.slice(0, opts.mtry)) {
    const cnt = new Array<number>(opts.nBins).fill(0);
    const sum = new Array<number>(opts.nBins).fill(0);
    const sq = new Array<number>(opts.nBins).fill(0);
    for (const i of idx) {
      const bb = B[i][f];
      cnt[bb]++;
      sum[bb] += target[i];
      sq[bb] += target[i] * target[i];
    }
    let lc = 0, ls = 0, lq = 0;
    for (let t = 0; t < opts.nBins - 1; t++) {
      lc += cnt[t];
      ls += sum[t];
      lq += sq[t];
      const rc = idx.length - lc;
      if (lc < opts.minLeaf || rc < opts.minLeaf) continue;
      const rs = totalS - ls;
      const rq = totalSS - lq;
      const sse = lq - (ls * ls) / lc + (rq - (rs * rs) / rc);
      const gain = parentSse - sse;
      if (gain > best.gain) best = { gain, feature: f, threshold: t };
    }
  }
  if (best.feature < 0) return { leaf: true, value: opts.leafValue(idx) };
  const L: number[] = [];
  const R: number[] = [];
  for (const i of idx) (B[i][best.feature] <= best.threshold ? L : R).push(i);
  return {
    leaf: false,
    feature: best.feature,
    threshold: best.threshold,
    left: buildTree(B, target, L, depth + 1, opts),
    right: buildTree(B, target, R, depth + 1, opts),
  };
}

export function trainRandomForest(X: number[][], y: number[], opts: { trees?: number; maxDepth?: number; minLeaf?: number; seed?: string } = {}): Model {
  const rng = createRng(opts.seed ?? 'rf');
  const binner = makeBinner(X);
  const B = X.map(binner.bin);
  const F = X[0].length;
  const n = X.length;
  const forest: TreeNode[] = [];
  const mean = (idx: number[]) => (idx.length ? idx.reduce((s, i) => s + y[i], 0) / idx.length : 0);
  for (let t = 0; t < (opts.trees ?? 25); t++) {
    const idx = Array.from({ length: n }, () => rng.int(0, n - 1));
    forest.push(buildTree(B, y, idx, 0, { maxDepth: opts.maxDepth ?? 5, minLeaf: opts.minLeaf ?? 30, mtry: Math.max(1, Math.round(Math.sqrt(F))), nBins: 16, rng, leafValue: mean }));
  }
  return { predict: (x) => clampP(forest.reduce((s, tr) => s + predictTree(tr, binner.bin(x)), 0) / forest.length) };
}

export function trainGradientBoosting(X: number[][], y: number[], opts: { rounds?: number; lr?: number; maxDepth?: number; minLeaf?: number; seed?: string } = {}): Model {
  const rng = createRng(opts.seed ?? 'gb');
  const binner = makeBinner(X);
  const B = X.map(binner.bin);
  const F = X[0].length;
  const n = X.length;
  const pbar = clampP(y.reduce((a, b) => a + b, 0) / n);
  const f0 = Math.log(pbar / (1 - pbar));
  const F_ = new Array<number>(n).fill(f0);
  const lr = opts.lr ?? 0.1;
  const trees: TreeNode[] = [];
  const all = Array.from({ length: n }, (_, i) => i);
  for (let r = 0; r < (opts.rounds ?? 30); r++) {
    const p = F_.map(sigmoid);
    const g = y.map((yi, i) => yi - p[i]); // âm gradient của log loss
    const leafValue = (idx: number[]) => {
      // Bước Newton cho log loss.
      let num = 0, den = 0;
      for (const i of idx) {
        num += g[i];
        den += p[i] * (1 - p[i]);
      }
      return den > 1e-12 ? num / den : 0;
    };
    const tree = buildTree(B, g, all, 0, { maxDepth: opts.maxDepth ?? 3, minLeaf: opts.minLeaf ?? 50, mtry: F, nBins: 16, rng, leafValue });
    trees.push(tree);
    for (let i = 0; i < n; i++) F_[i] += lr * predictTree(tree, B[i]);
  }
  return {
    predict(x) {
      const b = binner.bin(x);
      return clampP(sigmoid(trees.reduce((s, t) => s + lr * predictTree(t, b), f0)));
    },
  };
}

// ── Đánh giá ──
export interface EvalMetrics {
  logLoss: number;
  brier: number;
  auc: number;
  calibration: { bin: number; predicted: number; observed: number; count: number }[];
}

export function auc(scores: number[], y: number[]): number {
  const pairs = scores.map((s, i) => ({ s, y: y[i] })).sort((a, b) => a.s - b.s);
  let rank = 1;
  let sumPos = 0;
  let nPos = 0;
  for (let i = 0; i < pairs.length; ) {
    let j = i;
    while (j < pairs.length && pairs[j].s === pairs[i].s) j++;
    const avg = (rank + rank + (j - i) - 1) / 2;
    for (let k = i; k < j; k++) if (pairs[k].y === 1) {
      sumPos += avg;
      nPos++;
    }
    rank += j - i;
    i = j;
  }
  const nNeg = pairs.length - nPos;
  if (!nPos || !nNeg) return 0.5;
  return (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

export function evaluate(preds: number[], y: number[], bins = 10): EvalMetrics {
  let ll = 0, br = 0;
  preds.forEach((p, i) => {
    const q = clampP(p);
    ll += -(y[i] * Math.log(q) + (1 - y[i]) * Math.log(1 - q));
    br += (q - y[i]) ** 2;
  });
  const sorted = preds.map((p, i) => ({ p, y: y[i] })).sort((a, b) => a.p - b.p);
  const calibration: EvalMetrics['calibration'] = [];
  for (let b = 0; b < bins; b++) {
    const part = sorted.slice(Math.floor((b * sorted.length) / bins), Math.floor(((b + 1) * sorted.length) / bins));
    if (!part.length) continue;
    calibration.push({ bin: b + 1, predicted: part.reduce((s, x) => s + x.p, 0) / part.length, observed: part.reduce((s, x) => s + x.y, 0) / part.length, count: part.length });
  }
  return { logLoss: ll / preds.length, brier: br / preds.length, auc: auc(preds, y), calibration };
}

export type MlModelCode = 'logistic_regression' | 'random_forest' | 'gradient_boosting';

export interface MlModelReport {
  model: MlModelCode;
  test: EvalMetrics;
  baseline: EvalMetrics;
  brierSkill: number;
  /** Chênh lệch log loss trung bình mỗi kỳ (model − baseline) và KTC 95%. Âm = tốt hơn baseline. */
  logLossDiff: { mean: number; low: number; high: number };
  beatsBaseline: boolean;
  featureImportance: { feature: string; importance: number }[];
}

export interface MlResearchResult {
  draws: number;
  trainDraws: number;
  testDraws: number;
  rows: { train: number; test: number };
  models: MlModelReport[];
  verdict: string;
  notes: string[];
}

export const ML_MAX_DRAWS = 600;

export function runMlResearch(rules: GameRules, allDraws: DrawRecord[], opts: { models?: MlModelCode[]; trainFraction?: number; minHistory?: number; seed?: string; maxDraws?: number } = {}): MlResearchResult {
  const maxDraws = Math.min(opts.maxDraws ?? ML_MAX_DRAWS, ML_MAX_DRAWS);
  const draws = allDraws.slice(Math.max(0, allDraws.length - maxDraws));
  const minHistory = opts.minHistory ?? 30;
  if (draws.length < minHistory + 40) throw new RangeError(`Cần ít nhất ${minHistory + 40} kỳ quay để nghiên cứu ML (hiện có ${draws.length}).`);
  const N = mainPoolSize(rules);
  const p0 = rules.mainPicks / N;
  const ds = buildDataset(rules, draws, minHistory);
  const usable = draws.length - minHistory;
  const trainDraws = Math.floor(usable * (opts.trainFraction ?? 0.7));
  const splitRow = trainDraws * N;
  const Xtr = ds.X.slice(0, splitRow), ytr = ds.y.slice(0, splitRow);
  const Xte = ds.X.slice(splitRow), yte = ds.y.slice(splitRow);
  const baselinePred = yte.map(() => p0);
  const baseline = evaluate(baselinePred, yte);
  const seed = opts.seed ?? 'ml';
  const reports: MlModelReport[] = [];
  for (const code of opts.models ?? (['logistic_regression', 'random_forest', 'gradient_boosting'] as MlModelCode[])) {
    const model: Model =
      code === 'logistic_regression' ? trainLogistic(Xtr, ytr) : code === 'random_forest' ? trainRandomForest(Xtr, ytr, { seed }) : trainGradientBoosting(Xtr, ytr, { seed });
    const preds = Xte.map((x) => model.predict(x));
    const test = evaluate(preds, yte);
    // Chênh log loss theo từng kỳ để có KTC (các số trong cùng kỳ không độc lập).
    const perDraw: number[] = [];
    for (let d = 0; d < yte.length / N; d++) {
      let s = 0;
      for (let i = d * N; i < (d + 1) * N; i++) {
        const q = clampP(preds[i]);
        const ll = -(yte[i] * Math.log(q) + (1 - yte[i]) * Math.log(1 - q));
        const lb = -(yte[i] * Math.log(p0) + (1 - yte[i]) * Math.log(1 - p0));
        s += ll - lb;
      }
      perDraw.push(s / N);
    }
    const ci = meanInterval(perDraw);
    // Permutation importance trên tập test.
    const permRng = createRng(`${seed}-perm-${code}`);
    const importance = FEATURE_NAMES.map((name, j) => {
      const col = Xte.map((r) => r[j]);
      for (let i = col.length - 1; i > 0; i--) {
        const k = permRng.int(0, i);
        [col[i], col[k]] = [col[k], col[i]];
      }
      const pp = Xte.map((r, i) => model.predict(r.map((v, jj) => (jj === j ? col[i] : v))));
      return { feature: name, importance: evaluate(pp, yte).logLoss - test.logLoss };
    });
    reports.push({
      model: code,
      test,
      baseline,
      brierSkill: 1 - test.brier / baseline.brier,
      logLossDiff: { mean: ci.mean, low: ci.low, high: ci.high },
      beatsBaseline: ci.high < 0,
      featureImportance: importance.sort((a, b) => b.importance - a.importance),
    });
  }
  const anyBeats = reports.some((r) => r.beatsBaseline);
  return {
    draws: draws.length,
    trainDraws,
    testDraws: usable - trainDraws,
    rows: { train: Xtr.length, test: Xte.length },
    models: reports,
    verdict: anyBeats
      ? 'Có mô hình vượt baseline trên tập kiểm tra (KTC 95% của chênh log loss < 0). Đây là MỘT lần kiểm định trên NHIỀU mô hình, cần xác nhận bằng walk-forward backtest trên dữ liệu mới trước khi tin cậy.'
      : 'KHÔNG CÓ LỢI THẾ DỰ BÁO ĐƯỢC CHỨNG MINH: không mô hình nào vượt baseline ngẫu nhiên đồng đều một cách có ý nghĩa thống kê.',
    notes: [
      `Chia theo thời gian: ${trainDraws} kỳ huấn luyện, ${usable - trainDraws} kỳ kiểm tra; đặc trưng chỉ dùng dữ liệu trước mỗi kỳ.`,
      `Giới hạn ${ML_MAX_DRAWS} kỳ gần nhất mỗi lần chạy để đảm bảo giới hạn CPU của Worker.`,
      'Thử nhiều mô hình làm tăng rủi ro "may mắn" (multiple testing), kết luận cần kiểm định độc lập.',
    ],
  };
}
