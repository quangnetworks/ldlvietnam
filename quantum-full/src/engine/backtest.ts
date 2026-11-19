/**
 * BACKTESTING — Walk-forward.
 * Với mỗi kỳ mục tiêu t (theo thứ tự thời gian): chỉ dùng draws[0..t-1] để sinh danh mục, sau đó so với draws[t].
 * Có kiểm tra cứng chống look-ahead: mọi kỳ trong lịch sử phải có thời điểm < kỳ mục tiêu.
 * Luôn chạy kèm baseline Random Uniform để so sánh.
 */
import type { GameRules } from '../shared/game';
import { mainPoolSize } from '../shared/game';
import { scoreProbabilities } from './bayesian';
import { meanInterval, normalQuantile, wilsonInterval } from './distributions';
import { evaluateTicket } from './prize';
import { createRng } from './rng';
import { generateTickets, strategyProbabilities, type StrategyCode, type StrategyParams } from './strategies';
import type { DrawRecord, Ticket } from './types';

export interface BacktestConfig {
  strategies: StrategyCode[];
  ticketsPerDraw: number;
  /** Số kỳ lịch sử tối thiểu trước kỳ dự báo đầu tiên. */
  minHistory: number;
  seed: string;
  params: StrategyParams;
}

export interface StepResult {
  strategy: StrategyCode;
  drawId: number;
  drawCode: string;
  drawAt: string;
  historySize: number;
  historyCutoffAt: string | null;
  tickets: Ticket[];
  /** matchHistogram[k] = số vé trùng đúng k số chính. */
  matchHistogram: number[];
  specialMatches: number;
  tierHits: Record<string, number>;
  winningTickets: number;
  fixedPrize: number;
  jackpotHits: number;
  cost: number;
  brier: number | null;
  logLoss: number | null;
  /** Hiệu chỉnh xác suất: [tổng dự báo, tổng quan sát, số mẫu] theo 10 bin trên [0, 2·K/N]. */
  calibration: [number, number, number][] | null;
}

export class LookAheadError extends Error {}

export function ensureSortedUnique(draws: DrawRecord[]): void {
  for (let i = 1; i < draws.length; i++) {
    if (!(draws[i - 1].drawAt < draws[i].drawAt || (draws[i - 1].drawAt === draws[i].drawAt && draws[i - 1].drawCode < draws[i].drawCode)))
      throw new LookAheadError(`Dữ liệu chưa được sắp xếp/trùng thời điểm tại kỳ ${draws[i].drawCode}`);
  }
}

/** Chạy các bước walk-forward cho các chỉ số kỳ mục tiêu trong [from, to). */
export function runBacktestSteps(rules: GameRules, draws: DrawRecord[], config: BacktestConfig, from: number, to: number): StepResult[] {
  ensureSortedUnique(draws);
  const out: StepResult[] = [];
  const N = mainPoolSize(rules);
  const K = rules.mainPicks;
  for (let t = Math.max(from, config.minHistory); t < Math.min(to, draws.length); t++) {
    const target = draws[t];
    const history = draws.slice(0, t);
    // Kiểm tra cứng chống rò rỉ dữ liệu tương lai.
    for (const h of history) if (!(h.drawAt <= target.drawAt) || h.id === target.id) throw new LookAheadError(`Rò rỉ dữ liệu: kỳ ${h.drawCode} không trước kỳ ${target.drawCode}`);
    for (const strategy of config.strategies) {
      const rng = createRng(`${config.seed}:${strategy}:${target.drawCode}`);
      const tickets = generateTickets(strategy, { rules, history, rng, params: config.params }, config.ticketsPerDraw);
      const hist = new Array<number>(K + 1).fill(0);
      const tierHits: Record<string, number> = {};
      let special = 0, winning = 0, fixed = 0, jp = 0;
      for (const tk of tickets) {
        const ev = evaluateTicket(rules, tk, target.main, target.special);
        hist[ev.mainMatches]++;
        if (ev.specialMatched) special++;
        if (ev.tier) {
          tierHits[ev.tier.code] = (tierHits[ev.tier.code] ?? 0) + 1;
          winning++;
          if (ev.tier.kind === 'fixed') fixed += ev.tier.amount;
          else jp++;
        }
      }
      const probs = strategyProbabilities(strategy, { rules, history, params: config.params });
      let brier: number | null = null, logLoss: number | null = null;
      let calibration: StepResult['calibration'] = null;
      if (probs) {
        const s = scoreProbabilities(rules, probs, target.main);
        brier = s.brier;
        logLoss = s.logLoss;
        calibration = Array.from({ length: 10 }, () => [0, 0, 0] as [number, number, number]);
        const top = (2 * K) / N;
        const actual = new Set(target.main);
        probs.forEach((p, i) => {
          const b = Math.min(9, Math.max(0, Math.floor((p / top) * 10)));
          calibration![b][0] += p;
          calibration![b][1] += actual.has(rules.mainMin + i) ? 1 : 0;
          calibration![b][2] += 1;
        });
      }
      out.push({
        strategy,
        drawId: target.id,
        drawCode: target.drawCode,
        drawAt: target.drawAt,
        historySize: history.length,
        historyCutoffAt: history.length ? history[history.length - 1].drawAt : null,
        tickets,
        matchHistogram: hist,
        specialMatches: special,
        tierHits,
        winningTickets: winning,
        fixedPrize: fixed,
        jackpotHits: jp,
        cost: tickets.length * rules.ticketPrice,
        brier,
        logLoss,
        calibration,
      });
    }
  }
  return out;
}

export interface StrategySummary {
  strategy: StrategyCode;
  steps: number;
  tickets: number;
  meanMatches: { mean: number; low: number; high: number };
  theoreticalMeanMatches: number;
  matchDistribution: { matches: number; count: number; share: number }[];
  specialMatchRate: number | null;
  hitRate: { rate: number; low: number; high: number };
  tierHits: Record<string, number>;
  jackpotHits: number;
  totalCost: number;
  totalFixedPrize: number;
  roi: number;
  costPerTicket: number;
  brier: number | null;
  logLoss: number | null;
  calibration: { predicted: number; observed: number; count: number }[] | null;
  windows: { index: number; from: string; to: string; meanMatches: number; hitRate: number }[];
  vsBaseline: { meanMatchesDiff: { mean: number; low: number; high: number }; brierDiff: number | null; significant: boolean } | null;
}

export interface BacktestSummary {
  strategies: StrategySummary[];
  baseline: StrategyCode;
  verdict: string;
  edgeProven: boolean;
  bonferroniLevel: number;
  biasControls: string[];
}

export function summarizeBacktest(rules: GameRules, steps: StepResult[], windowsCount = 4): BacktestSummary {
  const K = rules.mainPicks;
  const N = mainPoolSize(rules);
  const byStrategy = new Map<StrategyCode, StepResult[]>();
  for (const s of steps) {
    if (!byStrategy.has(s.strategy)) byStrategy.set(s.strategy, []);
    byStrategy.get(s.strategy)!.push(s);
  }
  for (const arr of byStrategy.values()) arr.sort((a, b) => (a.drawAt < b.drawAt ? -1 : a.drawAt > b.drawAt ? 1 : 0));
  const baseSteps = byStrategy.get('random_uniform') ?? [];
  const baseByDraw = new Map(baseSteps.map((s) => [s.drawId, s]));
  const others = [...byStrategy.keys()].filter((k) => k !== 'random_uniform').length;
  const alpha = 0.05 / Math.max(1, others);
  const z = alpha < 0.05 ? normalQuantile(1 - alpha / 2) : 1.96;
  const meanMatchesOf = (s: StepResult) => s.matchHistogram.reduce((acc, c, k) => acc + c * k, 0) / Math.max(1, s.tickets.length);

  const summaries: StrategySummary[] = [...byStrategy.entries()].map(([strategy, arr]) => {
    const tickets = arr.reduce((s, x) => s + x.tickets.length, 0);
    const hist = new Array<number>(K + 1).fill(0);
    const tierHits: Record<string, number> = {};
    let special = 0, winning = 0, cost = 0, fixed = 0, jp = 0;
    const perStepMean: number[] = [];
    const briers: number[] = [];
    const lls: number[] = [];
    const cal = Array.from({ length: 10 }, () => [0, 0, 0]);
    let hasCal = false;
    for (const s of arr) {
      s.matchHistogram.forEach((c, k) => (hist[k] += c));
      for (const [k, v] of Object.entries(s.tierHits)) tierHits[k] = (tierHits[k] ?? 0) + v;
      special += s.specialMatches;
      winning += s.winningTickets;
      cost += s.cost;
      fixed += s.fixedPrize;
      jp += s.jackpotHits;
      perStepMean.push(meanMatchesOf(s));
      if (s.brier != null) briers.push(s.brier);
      if (s.logLoss != null) lls.push(s.logLoss);
      if (s.calibration) {
        hasCal = true;
        s.calibration.forEach((b, i) => {
          cal[i][0] += b[0];
          cal[i][1] += b[1];
          cal[i][2] += b[2];
        });
      }
    }
    const mm = meanInterval(perStepMean);
    const hr = wilsonInterval(winning, tickets);
    const wsize = Math.max(1, Math.ceil(arr.length / windowsCount));
    const windows: StrategySummary['windows'] = [];
    for (let w = 0; w * wsize < arr.length; w++) {
      const part = arr.slice(w * wsize, (w + 1) * wsize);
      const tk = part.reduce((s, x) => s + x.tickets.length, 0);
      windows.push({
        index: w + 1,
        from: part[0].drawAt,
        to: part[part.length - 1].drawAt,
        meanMatches: part.reduce((s, x) => s + meanMatchesOf(x) * x.tickets.length, 0) / Math.max(1, tk),
        hitRate: part.reduce((s, x) => s + x.winningTickets, 0) / Math.max(1, tk),
      });
    }
    let vsBaseline: StrategySummary['vsBaseline'] = null;
    if (strategy !== 'random_uniform' && baseSteps.length) {
      const diffs: number[] = [];
      const bd: number[] = [];
      for (const s of arr) {
        const b = baseByDraw.get(s.drawId);
        if (!b) continue;
        diffs.push(meanMatchesOf(s) - meanMatchesOf(b));
        if (s.brier != null && b.brier != null) bd.push(s.brier - b.brier);
      }
      const d = meanInterval(diffs);
      const half = d.n > 1 ? (z * d.sd) / Math.sqrt(d.n) : Infinity;
      vsBaseline = {
        meanMatchesDiff: { mean: d.mean, low: d.mean - half, high: d.mean + half },
        brierDiff: bd.length ? bd.reduce((a, b) => a + b, 0) / bd.length : null,
        significant: d.mean - half > 0,
      };
    }
    return {
      strategy,
      steps: arr.length,
      tickets,
      meanMatches: { mean: mm.mean, low: mm.low, high: mm.high },
      theoreticalMeanMatches: (K * K) / N,
      matchDistribution: hist.map((count, matches) => ({ matches, count, share: tickets ? count / tickets : 0 })),
      specialMatchRate: rules.specialMode === 'none' ? null : tickets ? special / tickets : 0,
      hitRate: { rate: tickets ? winning / tickets : 0, low: hr.low, high: hr.high },
      tierHits,
      jackpotHits: jp,
      totalCost: cost,
      totalFixedPrize: fixed,
      roi: cost ? (fixed - cost) / cost : 0,
      costPerTicket: rules.ticketPrice,
      brier: briers.length ? briers.reduce((a, b) => a + b, 0) / briers.length : null,
      logLoss: lls.length ? lls.reduce((a, b) => a + b, 0) / lls.length : null,
      calibration: hasCal ? cal.filter((c) => c[2] > 0).map((c) => ({ predicted: c[0] / c[2], observed: c[1] / c[2], count: c[2] })) : null,
      windows,
      vsBaseline,
    };
  });
  summaries.sort((a, b) => (a.strategy === 'random_uniform' ? -1 : b.strategy === 'random_uniform' ? 1 : a.strategy.localeCompare(b.strategy)));
  const edge = summaries.some((s) => s.vsBaseline?.significant);
  return {
    strategies: summaries,
    baseline: 'random_uniform',
    edgeProven: edge,
    bonferroniLevel: alpha,
    verdict: edge
      ? 'Một chiến lược có số trùng trung bình cao hơn baseline với mức ý nghĩa đã hiệu chỉnh Bonferroni. Cần xác nhận lại trên giai đoạn dữ liệu mới (out-of-sample) trước khi tin cậy — kết quả này có thể vẫn là may mắn.'
      : 'KHÔNG CÓ LỢI THẾ DỰ BÁO ĐƯỢC CHỨNG MINH: không chiến lược nào vượt baseline Random Uniform một cách có ý nghĩa thống kê.',
    biasControls: [
      'Look-ahead bias: mỗi kỳ chỉ dùng dữ liệu có thời điểm trước kỳ mục tiêu (kiểm tra cứng trong mã).',
      'Data leakage: đặc trưng/tần suất tính lại từ đầu cho mỗi bước; không dùng thống kê toàn cục.',
      'Survivorship/selection bias: báo cáo TẤT CẢ chiến lược đã chạy, kể cả chiến lược kém.',
      `Multiple testing: ngưỡng ý nghĩa hiệu chỉnh Bonferroni α = ${alpha.toFixed(4)} cho ${others} so sánh.`,
      'Overfitting: tham số chiến lược cố định trước khi chạy; seed và cấu hình được lưu để tái lập.',
      'Ổn định theo thời gian: chỉ số được tách theo nhiều cửa sổ thời gian liên tiếp.',
    ],
  };
}
