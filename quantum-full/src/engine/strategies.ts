/**
 * Chiến lược sinh bộ số. Mỗi chiến lược là một hàm thuần: (cấu hình game, lịch sử TRƯỚC thời điểm cắt, RNG) → vé.
 * Chiến lược nào có mô hình xác suất thì trả về vector xác suất từng số xuất hiện ở kỳ kế tiếp
 * (phục vụ Brier score / log loss trong backtest). Chiến lược không có mô hình trả về null.
 */
import type { GameRules } from '../shared/game';
import { mainPoolSize, playerPicksSpecial, specialPoolSize } from '../shared/game';
import { combination } from './combinatorics';
import { bayesianPredictive, countsOf } from './bayesian';
import { behaviorScore } from './behavior';
import { sampleDirichlet, sampleDistinct, sampleWeightedDistinct, type Rng } from './rng';
import { ticketKey } from './validation';
import type { DrawRecord, Ticket } from './types';

export type StrategyCode = 'random_uniform' | 'balanced' | 'statistical' | 'bayesian' | 'portfolio_optimized';

export interface StrategyParams {
  /** statistical: cửa sổ số kỳ gần nhất dùng để đếm tần suất. */
  window?: number;
  /** bayesian: độ mạnh prior (Beta) và α (Dirichlet). */
  priorStrength?: number;
  dirichletAlpha?: number;
  /** portfolio: giới hạn số chính trùng tối đa giữa hai vé. */
  maxOverlap?: number;
  /** portfolio: ưu tiên bộ số ít phổ biến (giảm rủi ro chia giải, KHÔNG tăng xác suất trúng). */
  avoidPopular?: boolean;
  /** portfolio: số ứng viên đánh giá cho mỗi vé. */
  candidates?: number;
}

export interface StrategyContext {
  rules: GameRules;
  history: DrawRecord[];
  rng: Rng;
  params: StrategyParams;
}

export interface StrategyInfo {
  code: StrategyCode;
  name: string;
  version: string;
  baseline: boolean;
  description: string;
  explanation: string;
}

export const STRATEGIES: Record<StrategyCode, StrategyInfo> = {
  random_uniform: {
    code: 'random_uniform',
    name: 'Ngẫu nhiên đồng đều',
    version: '1.0.0',
    baseline: true,
    description: 'Baseline khoa học: mỗi tổ hợp có xác suất được chọn như nhau.',
    explanation:
      'Chọn ngẫu nhiên đồng đều không hoàn lại (Fisher–Yates) bằng bộ sinh xoshiro128** có seed. Đây là mốc so sánh (baseline) cho mọi chiến lược khác.',
  },
  balanced: {
    code: 'balanced',
    name: 'Cân bằng',
    version: '1.0.0',
    baseline: false,
    description: 'Ngẫu nhiên có ràng buộc cân bằng chẵn/lẻ, thấp/cao, tổng, hạn chế dãy liên tiếp.',
    explanation:
      'Lấy mẫu ngẫu nhiên và chỉ giữ bộ số có cấu trúc "điển hình" (chẵn/lẻ, thấp/cao gần cân bằng; tổng trong ±1 độ lệch chuẩn; tối đa 2 số liên tiếp). Mỗi tổ hợp vẫn có xác suất trúng như mọi tổ hợp khác — ràng buộc chỉ thay đổi hình dạng bộ số, không thay đổi xác suất.',
  },
  statistical: {
    code: 'statistical',
    name: 'Nghiên cứu thống kê',
    version: '1.0.0',
    baseline: false,
    description: 'Thực nghiệm: trọng số theo tần suất trong cửa sổ gần nhất (làm trơn Laplace).',
    explanation:
      'Trọng số mỗi số = (số lần xuất hiện trong W kỳ gần nhất + 1). Lấy mẫu có trọng số không hoàn lại. Đây là GIẢ THUYẾT NGHIÊN CỨU cần kiểm định bằng backtest; với kỳ quay độc lập, lý thuyết dự đoán không có lợi thế.',
  },
  bayesian: {
    code: 'bayesian',
    name: 'Thực nghiệm Bayes',
    version: '1.0.0',
    baseline: false,
    description: 'Thompson sampling từ posterior Dirichlet với prior đồng đều.',
    explanation:
      'Prior Dirichlet đối xứng (α) cập nhật bằng số lần xuất hiện; mỗi vé lấy một mẫu tỷ trọng từ posterior rồi chọn số theo trọng số. Prior neo tại phân bố đồng đều, không tạo lợi thế giả.',
  },
  portfolio_optimized: {
    code: 'portfolio_optimized',
    name: 'Tối ưu danh mục',
    version: '1.0.0',
    baseline: false,
    description: 'Tối ưu độ phủ số/cặp, hạn chế trùng lặp giữa các vé; tuỳ chọn tránh bộ số phổ biến.',
    explanation:
      'Thuật toán tham lam: với mỗi vé, đánh giá nhiều ứng viên ngẫu nhiên đồng đều và chọn ứng viên phủ thêm nhiều số/cặp/bộ ba mới nhất, thoả giới hạn trùng lặp. Tối ưu ĐỘ PHỦ chỉ làm phân tán kết quả giữa các vé (giảm trùng lặp), KHÔNG làm tăng xác suất trúng của bất kỳ tổ hợp đơn lẻ nào; xác suất Jackpot của danh mục vẫn = số vé khác nhau / tổng số tổ hợp.',
  },
};

export function isStrategyCode(x: string): x is StrategyCode {
  return x in STRATEGIES;
}

function pickSpecial(rules: GameRules, rng: Rng, weights?: number[]): number | null {
  if (!playerPicksSpecial(rules)) return null;
  const min = rules.specialMin as number;
  if (weights) return sampleWeightedDistinct(rng, min, weights, 1)[0];
  return rng.int(min, rules.specialMax as number);
}

function uniformTicket(rules: GameRules, rng: Rng): Ticket {
  return { main: sampleDistinct(rng, rules.mainMin, rules.mainMax, rules.mainPicks), special: pickSpecial(rules, rng) };
}

function longestRun(sorted: number[]): number {
  let best = 1;
  let cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    cur = sorted[i] - sorted[i - 1] === 1 ? cur + 1 : 1;
    if (cur > best) best = cur;
  }
  return best;
}

export function isBalanced(rules: GameRules, main: number[]): boolean {
  const N = mainPoolSize(rules);
  const K = rules.mainPicks;
  const s = [...main].sort((a, b) => a - b);
  const odd = s.filter((x) => x % 2 === 1).length;
  const lowMax = Math.floor((rules.mainMin + rules.mainMax) / 2);
  const low = s.filter((x) => x <= lowMax).length;
  const half = K / 2;
  const sum = s.reduce((a, b) => a + b, 0);
  const mean = (K * (rules.mainMin + rules.mainMax)) / 2;
  const sd = Math.sqrt(((K * (N * N - 1)) / 12) * ((N - K) / (N - 1)));
  return Math.abs(odd - half) <= 1 && Math.abs(low - half) <= 1 && Math.abs(sum - mean) <= sd && longestRun(s) <= 2;
}

/** Vector xác suất mỗi số xuất hiện ở kỳ tới theo mô hình của chiến lược (hoặc null nếu không có mô hình). */
export function strategyProbabilities(code: StrategyCode, ctx: Omit<StrategyContext, 'rng'>): number[] | null {
  const { rules, history, params } = ctx;
  const N = mainPoolSize(rules);
  const K = rules.mainPicks;
  switch (code) {
    case 'random_uniform':
      return new Array<number>(N).fill(K / N);
    case 'statistical': {
      const w = frequencyWeights(rules, history, params.window ?? 100);
      const total = w.reduce((a, b) => a + b, 0);
      return w.map((x) => Math.min(0.999, (K * x) / total));
    }
    case 'bayesian':
      return bayesianPredictive(rules, history, params.priorStrength ?? 100);
    default:
      return null;
  }
}

export function frequencyWeights(rules: GameRules, history: DrawRecord[], window: number): number[] {
  const slice = history.slice(Math.max(0, history.length - window));
  return countsOf(rules, slice).map((c) => c + 1);
}

function specialFrequencyWeights(rules: GameRules, history: DrawRecord[], window: number, alpha = 1): number[] | undefined {
  if (!playerPicksSpecial(rules)) return undefined;
  const S = specialPoolSize(rules);
  const w = new Array<number>(S).fill(alpha);
  for (const d of history.slice(Math.max(0, history.length - window))) if (d.special != null) w[d.special - (rules.specialMin as number)]++;
  return w;
}

/** Sinh `count` vé KHÁC NHAU theo chiến lược. */
export function generateTickets(code: StrategyCode, ctx: StrategyContext, count: number): Ticket[] {
  const { rules, rng, history, params } = ctx;
  const total = combination(mainPoolSize(rules), rules.mainPicks) * Math.max(1, specialPoolSize(rules));
  if (count > total) throw new RangeError('Số vé vượt tổng số tổ hợp');
  if (code === 'portfolio_optimized') return optimizePortfolio(ctx, count).tickets;
  const out: Ticket[] = [];
  const seen = new Set<string>();
  const add = (t: Ticket) => {
    const k = ticketKey(t);
    if (seen.has(k)) return false;
    seen.add(k);
    out.push(t);
    return true;
  };
  let guard = 0;
  const maxAttempts = count * 5000;
  while (out.length < count) {
    if (++guard > maxAttempts) throw new Error('Không thể sinh đủ vé khác nhau thoả ràng buộc');
    switch (code) {
      case 'random_uniform':
        add(uniformTicket(rules, rng));
        break;
      case 'balanced': {
        const t = uniformTicket(rules, rng);
        if (isBalanced(rules, t.main)) add(t);
        break;
      }
      case 'statistical': {
        const w = frequencyWeights(rules, history, params.window ?? 100);
        add({ main: sampleWeightedDistinct(rng, rules.mainMin, w, rules.mainPicks), special: pickSpecial(rules, rng, specialFrequencyWeights(rules, history, params.window ?? 100)) });
        break;
      }
      case 'bayesian': {
        const alpha = params.dirichletAlpha ?? 1;
        const w = sampleDirichlet(rng, countsOf(rules, history).map((c) => alpha + c));
        const sw = specialFrequencyWeights(rules, history, history.length, alpha);
        add({ main: sampleWeightedDistinct(rng, rules.mainMin, w.map((x) => Math.max(x, 1e-12)), rules.mainPicks), special: pickSpecial(rules, rng, sw ? sampleDirichlet(rng, sw).map((x) => Math.max(x, 1e-12)) : undefined) });
        break;
      }
    }
  }
  return out;
}

// ───────────────────────────── Q8 — PORTFOLIO OPTIMIZER ─────────────────────────────

function pairsOf(main: number[]): string[] {
  const s = [...main].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) out.push(`${s[i]}-${s[j]}`);
  return out;
}

function triplesOf(main: number[]): string[] {
  const s = [...main].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) for (let k = j + 1; k < s.length; k++) out.push(`${s[i]}-${s[j]}-${s[k]}`);
  return out;
}

function overlap(a: number[], b: number[]): number {
  const s = new Set(a);
  return b.filter((x) => s.has(x)).length;
}

export interface PortfolioMetrics {
  ticketCount: number;
  uniqueTickets: number;
  duplicateTickets: number;
  numbersCovered: number;
  numberCoverage: number;
  pairsCovered: number;
  pairCoverage: number;
  triplesCovered: number;
  tripleCoverage: number;
  /** Số cặp số xuất hiện ở từ 2 vé trở lên ("số cặp trùng"). */
  repeatedPairs: number;
  maxOverlap: number;
  meanOverlap: number;
  specialsCovered: number | null;
  meanPopularityPercentile: number;
}

export function portfolioMetrics(rules: GameRules, tickets: Ticket[]): PortfolioMetrics {
  const N = mainPoolSize(rules);
  const nums = new Set<number>();
  const pairCount = new Map<string, number>();
  const triples = new Set<string>();
  const specials = new Set<number>();
  for (const t of tickets) {
    t.main.forEach((x) => nums.add(x));
    for (const p of pairsOf(t.main)) pairCount.set(p, (pairCount.get(p) ?? 0) + 1);
    if (rules.mainPicks >= 3) triplesOf(t.main).forEach((x) => triples.add(x));
    if (t.special != null) specials.add(t.special);
  }
  let maxO = 0;
  let sumO = 0;
  let pairsN = 0;
  for (let i = 0; i < tickets.length; i++)
    for (let j = i + 1; j < tickets.length; j++) {
      const o = overlap(tickets[i].main, tickets[j].main);
      maxO = Math.max(maxO, o);
      sumO += o;
      pairsN++;
    }
  const unique = new Set(tickets.map(ticketKey)).size;
  const pop = tickets.length ? tickets.reduce((s, t) => s + behaviorScore(rules, t.main).percentile, 0) / tickets.length : 0;
  return {
    ticketCount: tickets.length,
    uniqueTickets: unique,
    duplicateTickets: tickets.length - unique,
    numbersCovered: nums.size,
    numberCoverage: nums.size / N,
    pairsCovered: pairCount.size,
    pairCoverage: pairCount.size / combination(N, 2),
    triplesCovered: triples.size,
    tripleCoverage: rules.mainPicks >= 3 ? triples.size / combination(N, 3) : 0,
    repeatedPairs: [...pairCount.values()].filter((c) => c > 1).length,
    maxOverlap: maxO,
    meanOverlap: pairsN ? sumO / pairsN : 0,
    specialsCovered: playerPicksSpecial(rules) ? specials.size : null,
    meanPopularityPercentile: pop,
  };
}

export interface PortfolioResult {
  tickets: Ticket[];
  metrics: PortfolioMetrics;
  relaxedConstraints: boolean;
}

export function optimizePortfolio(ctx: StrategyContext, count: number): PortfolioResult {
  const { rules, rng, params } = ctx;
  const maxOverlap = params.maxOverlap ?? Math.max(1, rules.mainPicks - 3);
  const C = Math.min(1000, Math.max(20, params.candidates ?? 200));
  const avoidPopular = params.avoidPopular ?? true;
  const tickets: Ticket[] = [];
  const seen = new Set<string>();
  const nums = new Set<number>();
  const pairs = new Set<string>();
  const triples = new Set<string>();
  let relaxed = false;
  // Số đặc biệt: xoay vòng để phủ đều nhóm đặc biệt, bắt đầu từ vị trí ngẫu nhiên.
  const S = specialPoolSize(rules);
  const specialOffset = S ? rng.int(0, S - 1) : 0;
  while (tickets.length < count) {
    let best: { t: Ticket; score: number } | null = null;
    let fallback: { t: Ticket; score: number } | null = null;
    for (let c = 0; c < C; c++) {
      const main = sampleDistinct(rng, rules.mainMin, rules.mainMax, rules.mainPicks);
      const special = playerPicksSpecial(rules) ? (rules.specialMin as number) + ((specialOffset + tickets.length) % S) : null;
      const t: Ticket = { main, special };
      if (seen.has(ticketKey(t))) continue;
      const maxO = tickets.reduce((m, x) => Math.max(m, overlap(x.main, main)), 0);
      let score = 0;
      score += main.filter((x) => !nums.has(x)).length * 3;
      score += pairsOf(main).filter((p) => !pairs.has(p)).length * 1;
      if (rules.mainPicks >= 3) score += triplesOf(main).filter((p) => !triples.has(p)).length * 0.25;
      if (avoidPopular) score -= behaviorScore(rules, main).percentile / 25;
      score -= maxO * 0.5;
      if (maxO <= maxOverlap) {
        if (!best || score > best.score) best = { t, score };
      } else if (!fallback || score > fallback.score) fallback = { t, score };
    }
    const chosen = best ?? fallback;
    if (!chosen) continue;
    if (!best) relaxed = true;
    tickets.push(chosen.t);
    seen.add(ticketKey(chosen.t));
    chosen.t.main.forEach((x) => nums.add(x));
    pairsOf(chosen.t.main).forEach((p) => pairs.add(p));
    if (rules.mainPicks >= 3) triplesOf(chosen.t.main).forEach((p) => triples.add(p));
  }
  return { tickets, metrics: portfolioMetrics(rules, tickets), relaxedConstraints: relaxed };
}
