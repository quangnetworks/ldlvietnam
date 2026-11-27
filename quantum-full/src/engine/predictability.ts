/**
 * PREDICTABILITY AUDIT — "Có đoán được thuật toán quay số không?"
 *
 * Gom các kiểm định giả thuyết H0 "mỗi kỳ quay độc lập và đồng đều" cùng backtest walk-forward của các chiến lược
 * chọn số phổ biến (nóng / lạnh / lặp kỳ trước / gan). Mọi giá trị p được hiệu chỉnh đa kiểm định (Benjamini–Hochberg).
 *
 * Phán quyết:
 *  - insufficient: chưa đủ dữ liệu để kết luận.
 *  - exploitable: có chiến lược vượt chuẩn lý thuyết với q < α (cần kiểm chứng tiếp trên dữ liệu mới).
 *  - anomaly: có kiểm định lệch với q < α nhưng KHÔNG chiến lược nào khai thác được.
 *  - random: không phát hiện dấu hiệu nào khác ngẫu nhiên.
 */
import type { GameRules } from '../shared/game';
import { mainPoolSize, specialPoolSize } from '../shared/game';
import { combination, rToNumber } from './combinatorics';
import { benjaminiHochberg, chiSquareSurvival, normalCdf, twoSidedP } from './distributions';
import { simulateDraw } from './montecarlo';
import { mainMatchProbability } from './probability';
import { createRng } from './rng';
import { exactSumDistribution } from './statistics';
import type { DrawRecord } from './types';

export const PREDICTABILITY_MIN_DRAWS = 200;

/** Số thập phân kiểu Việt Nam (dấu phẩy). */
const f = (x: number, d: number) => x.toFixed(d).replace('.', ',');

export interface AuditTest {
  code: string;
  name: string;
  /** Diễn giải ngắn của giả thuyết đang kiểm. */
  question: string;
  statistic: number;
  df: number | null;
  pValue: number;
  qValue: number;
  significant: boolean;
  detail: string;
}

export interface AuditStrategy {
  code: string;
  name: string;
  target: 'main' | 'special';
  steps: number;
  /** main: số trùng trung bình/vé; special: tỷ lệ trúng số đặc biệt. */
  observed: number;
  expected: number;
  z: number;
  /** Một phía: chiến lược tốt HƠN chọn ngẫu nhiên. */
  pValue: number;
  qValue: number;
  beatsRandom: boolean;
  /** main: số lần vé trùng ≥ 3 số chính. */
  hits3Plus: number | null;
}

export type AuditVerdict = 'insufficient' | 'random' | 'anomaly' | 'exploitable';

export interface PredictabilityResult {
  draws: number;
  firstDrawAt: string | null;
  lastDrawAt: string | null;
  alpha: number;
  warmup: number;
  window: number;
  tests: AuditTest[];
  strategies: AuditStrategy[];
  verdict: AuditVerdict;
  headline: string;
  explanation: string[];
}

export interface AuditOptions {
  /** Số kỳ đầu chỉ dùng làm lịch sử, không chấm điểm chiến lược. */
  warmup?: number;
  /** Cửa sổ đếm tần suất cho chiến lược nóng/lạnh. */
  window?: number;
  alpha?: number;
  /** Số lịch sử mô phỏng dưới H0 để hiệu chỉnh phương sai kiểm định cặp số. */
  nullSimulations?: number;
}

/** Trung bình & phương sai CHÍNH XÁC của số trùng giữa một bộ K số và kỳ quay (phân phối siêu bội). */
export function matchMoments(rules: GameRules): { mean: number; variance: number } {
  let m = 0;
  let m2 = 0;
  for (let k = 0; k <= rules.mainPicks; k++) {
    const p = rToNumber(mainMatchProbability(rules, k));
    m += k * p;
    m2 += k * k * p;
  }
  return { mean: m, variance: m2 - m * m };
}

function countMatches(a: number[], b: number[]): number {
  let c = 0;
  for (const x of a) if (b.includes(x)) c++;
  return c;
}

function specialBounds(rules: GameRules): { min: number; size: number } | null {
  if (rules.specialMode === 'separate_pool') return { min: rules.specialMin as number, size: specialPoolSize(rules) };
  if (rules.specialMode === 'bonus_from_main') return { min: rules.mainMin, size: mainPoolSize(rules) };
  return null;
}

function pairStatistic(rules: GameRules, draws: DrawRecord[]): number {
  const N = mainPoolSize(rules);
  const counts = new Float64Array(N * N);
  for (const d of draws) {
    const s = d.main;
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length; j++) {
        const a = Math.min(s[i], s[j]) - rules.mainMin;
        const b = Math.max(s[i], s[j]) - rules.mainMin;
        counts[a * N + b]++;
      }
  }
  const M = combination(N, 2);
  const E = (draws.length * combination(rules.mainPicks, 2)) / M;
  let x2 = 0;
  for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) x2 += (counts[a * N + b] - E) ** 2 / E;
  return x2;
}

/** Chia phân phối tổng chính xác thành các nhóm có xác suất gần bằng nhau. */
function sumBins(rules: GameRules, bins: number): { from: number; to: number; p: number }[] {
  const dist = [...exactSumDistribution(rules).entries()].sort((a, b) => a[0] - b[0]);
  const out: { from: number; to: number; p: number }[] = [];
  let acc = 0;
  let start = dist[0][0];
  let cum = 0;
  for (const [s, p] of dist) {
    acc += p;
    cum += p;
    if (cum >= (out.length + 1) / bins - 1e-12 && out.length < bins - 1) {
      out.push({ from: start, to: s, p: acc });
      acc = 0;
      start = s + 1;
    }
  }
  out.push({ from: start, to: dist[dist.length - 1][0], p: acc });
  return out.filter((b) => b.p > 0);
}

function runTests(rules: GameRules, draws: DrawRecord[], nullSims: number): Omit<AuditTest, 'qValue' | 'significant'>[] {
  const N = mainPoolSize(rules);
  const K = rules.mainPicks;
  const n = draws.length;
  const out: Omit<AuditTest, 'qValue' | 'significant'>[] = [];

  // 1) Phân bố đều số chính — hiệu chỉnh tương quan âm giữa các ô (mỗi kỳ đúng K số khác nhau).
  const counts = new Array<number>(N).fill(0);
  for (const d of draws) for (const x of d.main) counts[x - rules.mainMin]++;
  const E = (n * K) / N;
  const x2 = counts.reduce((s, c) => s + (c - E) ** 2 / E, 0);
  const adj = (x2 * (N - 1)) / (N - K);
  const sd = Math.sqrt(n * (K / N) * (1 - K / N));
  const dev = counts
    .map((c, i) => ({ x: rules.mainMin + i, z: (c - E) / sd, c }))
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, 3)
    .map((d) => `${String(d.x).padStart(2, '0')} (${d.c} lần, z = ${f(d.z, 2)})`);
  out.push({ code: 'main_uniform', name: 'Phân bố đều các số chính', question: `Mỗi số 1–${N} có cùng xác suất ${K}/${N} mỗi kỳ?`, statistic: adj, df: N - 1, pValue: chiSquareSurvival(adj, N - 1), detail: `Kỳ vọng ${f(E, 1)} lần/số. Lệch nhiều nhất: ${dev.join(', ')}.` });

  // 2) Phân bố đều số đặc biệt.
  const sb = specialBounds(rules);
  const withSpecial = draws.filter((d) => d.special != null);
  if (sb && withSpecial.length) {
    const sc = new Array<number>(sb.size).fill(0);
    for (const d of withSpecial) sc[(d.special as number) - sb.min]++;
    const e = withSpecial.length / sb.size;
    const sx2 = sc.reduce((s, c) => s + (c - e) ** 2 / e, 0);
    out.push({ code: 'special_uniform', name: 'Phân bố đều số đặc biệt', question: `Mỗi số đặc biệt có cùng xác suất 1/${sb.size}?`, statistic: sx2, df: sb.size - 1, pValue: chiSquareSurvival(sx2, sb.size - 1), detail: `Kỳ vọng ${f(e, 1)} lần/số.` });
  }

  // 3) Đồng xuất hiện cặp số — kỳ vọng thống kê tính chính xác, phương sai hiệu chỉnh bằng mô phỏng H0 (Satterthwaite).
  const M = combination(N, 2);
  const q = (K * (K - 1)) / (N * (N - 1));
  if ((n * combination(K, 2)) / M >= 5) {
    const obs = pairStatistic(rules, draws);
    const mean = M * (1 - q);
    const rng = createRng(`predictability-null-${n}`);
    const sims: number[] = [];
    for (let b = 0; b < nullSims; b++) {
      const h: DrawRecord[] = [];
      for (let i = 0; i < n; i++) {
        const d = simulateDraw(rules, rng);
        h.push({ id: i, drawCode: '', drawAt: '', main: d.main, special: d.special });
      }
      sims.push(pairStatistic(rules, h));
    }
    const v = sims.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, sims.length - 1);
    const scale = v / (2 * mean);
    const nu = (2 * mean * mean) / v;
    out.push({ code: 'pair_uniform', name: 'Đồng xuất hiện các cặp số', question: 'Có cặp số nào hay đi cùng nhau hơn ngẫu nhiên?', statistic: obs, df: Math.round(nu), pValue: chiSquareSurvival(obs / scale, nu), detail: `${M} cặp, kỳ vọng ${f(((n * combination(K, 2)) / M), 1)} lần/cặp; phương sai thống kê hiệu chỉnh từ ${nullSims} lịch sử mô phỏng.` });
  }

  // 4) Số trùng với kỳ ngay trước — mỗi giá trị độc lập, phân phối siêu bội chính xác dưới H0.
  if (n >= 2) {
    const mm = matchMoments(rules);
    let sum = 0;
    for (let i = 1; i < n; i++) sum += countMatches(draws[i].main, draws[i - 1].main);
    const avg = sum / (n - 1);
    const z = (avg - mm.mean) / Math.sqrt(mm.variance / (n - 1));
    out.push({ code: 'repeat_previous', name: 'Phụ thuộc vào kỳ trước (số chính)', question: 'Kỳ sau có xu hướng lặp lại / né số của kỳ trước?', statistic: z, df: null, pValue: twoSidedP(z), detail: `Trung bình ${f(avg, 3)} số trùng, lý thuyết ${f(mm.mean, 3)}.` });
  }

  // 5) Chuyển tiếp số đặc biệt (chỉ game có nhóm đặc biệt riêng): bảng S×S, kiểm định độc lập χ².
  if (rules.specialMode === 'separate_pool' && sb && withSpecial.length >= sb.size * sb.size * 2) {
    const S = sb.size;
    const T = new Array<number>(S * S).fill(0);
    let tot = 0;
    for (let i = 1; i < n; i++) {
      const a = draws[i - 1].special;
      const b = draws[i].special;
      if (a == null || b == null) continue;
      T[(a - sb.min) * S + (b - sb.min)]++;
      tot++;
    }
    const rs = new Array<number>(S).fill(0);
    const cs = new Array<number>(S).fill(0);
    for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) (rs[a] += T[a * S + b]), (cs[b] += T[a * S + b]);
    let tx2 = 0;
    for (let a = 0; a < S; a++)
      for (let b = 0; b < S; b++) {
        const e = (rs[a] * cs[b]) / tot;
        if (e > 0) tx2 += (T[a * S + b] - e) ** 2 / e;
      }
    const df = (S - 1) * (S - 1);
    out.push({ code: 'special_markov', name: 'Phụ thuộc vào kỳ trước (số đặc biệt)', question: 'Số đặc biệt kỳ trước có ảnh hưởng đến kỳ sau?', statistic: tx2, df, pValue: chiSquareSurvival(tx2, df), detail: `Bảng chuyển tiếp ${S}×${S} với ${tot} cặp kỳ liên tiếp.` });
  }

  // 6) Phân bố tổng các số chính so với phân phối CHÍNH XÁC (quy hoạch động).
  const nb = Math.max(4, Math.min(12, Math.floor(n / 50)));
  const bins = sumBins(rules, nb);
  const bc = bins.map(() => 0);
  for (const d of draws) {
    const s = d.main.reduce((a, b) => a + b, 0);
    const i = bins.findIndex((b) => s >= b.from && s <= b.to);
    if (i >= 0) bc[i]++;
  }
  const sx2 = bins.reduce((s, b, i) => s + (bc[i] - n * b.p) ** 2 / (n * b.p), 0);
  out.push({ code: 'sum_distribution', name: 'Phân bố tổng các số', question: 'Tổng các số có lệch khỏi phân phối lý thuyết?', statistic: sx2, df: bins.length - 1, pValue: chiSquareSurvival(sx2, bins.length - 1), detail: `${bins.length} nhóm tổng có xác suất gần bằng nhau.` });

  return out;
}

type MainPredictor = (counts: number[], last: number[], lastSeen: number[], prev: DrawRecord) => number[];

function topK(rules: GameRules, score: (i: number) => number, k: number): number[] {
  const N = mainPoolSize(rules);
  return Array.from({ length: N }, (_, i) => i)
    .sort((a, b) => score(b) - score(a) || a - b)
    .slice(0, k)
    .map((i) => i + rules.mainMin);
}

function runStrategies(rules: GameRules, draws: DrawRecord[], warmup: number, window: number): Omit<AuditStrategy, 'qValue' | 'beatsRandom'>[] {
  const N = mainPoolSize(rules);
  const K = rules.mainPicks;
  const mm = matchMoments(rules);
  const main: Record<string, { name: string; f: MainPredictor }> = {
    hot: { name: `Số "nóng" (ra nhiều nhất ${window} kỳ gần nhất)`, f: (c) => topK(rules, (i) => c[i], K) },
    cold: { name: `Số "lạnh" (ra ít nhất ${window} kỳ gần nhất)`, f: (c) => topK(rules, (i) => -c[i], K) },
    repeat: { name: 'Lặp lại bộ số kỳ trước', f: (_c, _l, _s, prev) => prev.main },
    overdue: { name: 'Số "gan" (lâu chưa ra nhất)', f: (_c, _l, seen) => topK(rules, (i) => -seen[i], K) },
  };
  const sb = rules.specialMode === 'separate_pool' ? { min: rules.specialMin as number, size: specialPoolSize(rules) } : null;
  const res: Record<string, { sum: number; steps: number; hits3: number }> = {};
  for (const k of Object.keys(main)) res[k] = { sum: 0, steps: 0, hits3: 0 };
  const sp = { hot: 0, repeat: 0, steps: 0 };
  const counts = new Array<number>(N).fill(0);
  const lastSeen = new Array<number>(N).fill(-1);
  const sCounts = sb ? new Array<number>(sb.size).fill(0) : [];
  for (let i = 0; i < draws.length; i++) {
    if (i >= warmup && i > 0) {
      const prev = draws[i - 1];
      for (const [k, s] of Object.entries(main)) {
        const pick = s.f(counts, prev.main, lastSeen, prev);
        const m = countMatches(pick, draws[i].main);
        res[k].sum += m;
        res[k].steps++;
        if (m >= 3) res[k].hits3++;
      }
      if (sb && draws[i].special != null && prev.special != null) {
        let best = 0;
        for (let s = 1; s < sb.size; s++) if (sCounts[s] > sCounts[best]) best = s;
        if (best + sb.min === draws[i].special) sp.hot++;
        if (prev.special === draws[i].special) sp.repeat++;
        sp.steps++;
      }
    }
    // Cập nhật cửa sổ trượt SAU khi chấm điểm (không nhìn trước).
    for (const x of draws[i].main) {
      counts[x - rules.mainMin]++;
      lastSeen[x - rules.mainMin] = i;
    }
    if (i - window >= 0) for (const x of draws[i - window].main) counts[x - rules.mainMin]--;
    if (sb && draws[i].special != null) {
      sCounts[(draws[i].special as number) - sb.min]++;
      const old = i - window >= 0 ? draws[i - window].special : null;
      if (old != null) sCounts[old - sb.min]--;
    }
  }
  const out: Omit<AuditStrategy, 'qValue' | 'beatsRandom'>[] = [];
  for (const [k, s] of Object.entries(main)) {
    const r = res[k];
    if (!r.steps) continue;
    const obs = r.sum / r.steps;
    const z = (obs - mm.mean) / Math.sqrt(mm.variance / r.steps);
    out.push({ code: `main_${k}`, name: s.name, target: 'main', steps: r.steps, observed: obs, expected: mm.mean, z, pValue: 1 - normalCdf(z), hits3Plus: r.hits3 });
  }
  if (sb && sp.steps) {
    const p0 = 1 / sb.size;
    const se = Math.sqrt((p0 * (1 - p0)) / sp.steps);
    for (const [k, name, hits] of [
      ['special_hot', `Số đặc biệt "nóng" (${window} kỳ)`, sp.hot],
      ['special_repeat', 'Số đặc biệt lặp lại kỳ trước', sp.repeat],
    ] as const) {
      const obs = hits / sp.steps;
      const z = (obs - p0) / se;
      out.push({ code: k, name, target: 'special', steps: sp.steps, observed: obs, expected: p0, z, pValue: 1 - normalCdf(z), hits3Plus: null });
    }
  }
  return out;
}

export function predictabilityAudit(rules: GameRules, draws: DrawRecord[], opts: AuditOptions = {}): PredictabilityResult {
  const alpha = opts.alpha ?? 0.05;
  const window = Math.max(5, opts.window ?? 50);
  const warmup = Math.max(window, opts.warmup ?? 100);
  const n = draws.length;
  const base = { draws: n, firstDrawAt: draws[0]?.drawAt ?? null, lastDrawAt: draws[n - 1]?.drawAt ?? null, alpha, warmup, window };
  if (n < PREDICTABILITY_MIN_DRAWS) {
    return { ...base, tests: [], strategies: [], verdict: 'insufficient', headline: 'CHƯA ĐỦ DỮ LIỆU ĐỂ KẾT LUẬN', explanation: [`Cần ít nhất ${PREDICTABILITY_MIN_DRAWS} kỳ quay; hiện có ${n}. Hãy đồng bộ thêm dữ liệu tại Data Center.`] };
  }
  const rawTests = runTests(rules, draws, Math.max(20, opts.nullSimulations ?? 60));
  const rawStrategies = runStrategies(rules, draws, warmup, window);
  const q = benjaminiHochberg([...rawTests.map((t) => t.pValue), ...rawStrategies.map((s) => s.pValue)]);
  const tests: AuditTest[] = rawTests.map((t, i) => ({ ...t, qValue: q[i], significant: q[i] < alpha }));
  const strategies: AuditStrategy[] = rawStrategies.map((s, i) => ({ ...s, qValue: q[rawTests.length + i], beatsRandom: q[rawTests.length + i] < alpha && s.z > 0 }));
  const winners = strategies.filter((s) => s.beatsRandom);
  const flagged = tests.filter((t) => t.significant);
  const minP = Math.min(...tests.map((t) => t.pValue), ...strategies.map((s) => s.pValue));
  const total = tests.length + strategies.length;
  const explanation: string[] = [];
  let verdict: AuditVerdict;
  let headline: string;
  if (winners.length) {
    verdict = 'exploitable';
    headline = 'PHÁT HIỆN CHIẾN LƯỢC VƯỢT NGẪU NHIÊN: CẦN KIỂM CHỨNG';
    explanation.push(`Chiến lược vượt chuẩn sau hiệu chỉnh đa kiểm định: ${winners.map((w) => `${w.name} (q = ${f(w.qValue, 3)})`).join('; ')}.`);
    explanation.push('Hãy kiểm tra chất lượng dữ liệu (kỳ nhập sai, trùng) và xác nhận lại trên các kỳ quay MỚI trước khi tin vào kết quả này.');
  } else if (flagged.length) {
    verdict = 'anomaly';
    headline = 'CÓ ĐỘ LỆCH THỐNG KÊ NHƯNG KHÔNG KHAI THÁC ĐƯỢC';
    explanation.push(`Kiểm định lệch sau hiệu chỉnh: ${flagged.map((t) => `${t.name} (q = ${f(t.qValue, 3)})`).join('; ')}.`);
    explanation.push('Không chiến lược chọn số nào vượt chọn ngẫu nhiên trên dữ liệu kiểm tra walk-forward. Nên rà soát dữ liệu nhập (kỳ chưa xác minh) trước khi diễn giải.');
  } else {
    verdict = 'random';
    headline = 'KHÔNG CÓ QUY LUẬT KHAI THÁC ĐƯỢC, KỲ QUAY KHỚP NGẪU NHIÊN';
    explanation.push(`${total} kiểm định đều không có ý nghĩa sau hiệu chỉnh Benjamini–Hochberg (p nhỏ nhất = ${f(minP, 3)}; với ${total} kiểm định, gặp p cỡ này do ngẫu nhiên là bình thường).`);
    explanation.push('Không chiến lược nóng / lạnh / lặp lại / gan nào cho số trùng nhiều hơn chọn ngẫu nhiên. Vì vậy không thể suy ra "thuật toán quay số" để đoán số.');
  }
  explanation.push('Điều toán học làm được: phối hợp nhiều vé để tăng xác suất có ít nhất một vé trúng (trúng đều hơn) với cùng chi phí, giá trị kỳ vọng không đổi.');
  return { ...base, tests, strategies, verdict, headline, explanation };
}
