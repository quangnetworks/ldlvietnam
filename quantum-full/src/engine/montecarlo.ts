/**
 * Q5 — MONTE CARLO ENGINE
 * Mô phỏng kỳ quay theo đúng thể lệ (đồng đều, không hoàn lại) với seed tái lập được.
 * Giới hạn khối lượng tính toán mỗi request để không vượt CPU limit của Worker.
 */
import type { GameRules } from '../shared/game';
import { mainPoolSize, specialPoolSize } from '../shared/game';
import { tierProbabilities } from './probability';
import { evaluateTicket } from './prize';
import { createRng, sampleDistinct, type Rng } from './rng';
import { meanInterval, wilsonInterval } from './distributions';
import type { Ticket } from './types';

/** Tối đa số (vé × kỳ mô phỏng) trong một request. */
export const MONTE_CARLO_MAX_WORK = 2_000_000;

export function simulateDraw(rules: GameRules, rng: Rng): { main: number[]; special: number | null } {
  if (rules.specialMode === 'bonus_from_main') {
    const all = sampleDistinct(rng, rules.mainMin, rules.mainMax, rules.mainPicks + 1);
    // Chọn ngẫu nhiên 1 trong K+1 số làm số đặc biệt (tương đương quay K số rồi quay thêm 1 số từ phần còn lại).
    const idx = rng.int(0, all.length - 1);
    const special = all[idx];
    return { main: all.filter((_, i) => i !== idx), special };
  }
  const main = sampleDistinct(rng, rules.mainMin, rules.mainMax, rules.mainPicks);
  const special = rules.specialMode === 'separate_pool' ? rng.int(rules.specialMin as number, rules.specialMax as number) : null;
  return { main, special };
}

export interface MonteCarloTierStat {
  code: string;
  name: string;
  hits: number;
  observedRate: number;
  theoreticalRate: number;
  expectedHits: number;
  ci95: { low: number; high: number };
  consistent: boolean;
}

export interface MonteCarloResult {
  seed: string;
  draws: number;
  ticketsPerDraw: number;
  ticketDraws: number;
  tiers: MonteCarloTierStat[];
  anyPrize: { ticketHits: number; drawsWithAnyPrize: number; drawRate: number; ci95: { low: number; high: number } };
  matchHistogram: { matches: number; count: number }[];
  finance: {
    totalCost: number;
    totalFixedPrizes: number;
    jackpotHits: number;
    netPerDraw: { mean: number; low: number; high: number };
    roiFixedOnly: number;
  };
  notes: string[];
}

export function runMonteCarlo(rules: GameRules, tickets: Ticket[], draws: number, seed: string): MonteCarloResult {
  if (!tickets.length) throw new RangeError('Cần ít nhất 1 vé');
  if (!Number.isInteger(draws) || draws < 1) throw new RangeError('Số kỳ mô phỏng phải ≥ 1');
  if (draws * tickets.length > MONTE_CARLO_MAX_WORK)
    throw new RangeError(`Khối lượng mô phỏng ${draws * tickets.length} vượt giới hạn ${MONTE_CARLO_MAX_WORK} (vé × kỳ) cho một request`);
  const rng = createRng(seed);
  const hits = new Map<string, number>();
  for (const t of rules.prizeTiers) hits.set(t.code, 0);
  const hist = new Array<number>(rules.mainPicks + 1).fill(0);
  let anyTicket = 0;
  let drawsAny = 0;
  let fixed = 0;
  let jackpots = 0;
  const netPerDraw: number[] = [];
  const cost = tickets.length * rules.ticketPrice;
  for (let d = 0; d < draws; d++) {
    const res = simulateDraw(rules, rng);
    let won = false;
    let prize = 0;
    for (const t of tickets) {
      const ev = evaluateTicket(rules, t, res.main, res.special);
      hist[ev.mainMatches]++;
      if (ev.tier) {
        hits.set(ev.tier.code, (hits.get(ev.tier.code) ?? 0) + 1);
        anyTicket++;
        won = true;
        if (ev.tier.kind === 'fixed') prize += ev.tier.amount;
        else jackpots++;
      }
    }
    if (won) drawsAny++;
    fixed += prize;
    netPerDraw.push(prize - cost);
  }
  const td = draws * tickets.length;
  const theo = tierProbabilities(rules);
  const tiers: MonteCarloTierStat[] = theo.map((tp) => {
    const h = hits.get(tp.tier.code) ?? 0;
    const ci = wilsonInterval(h, td);
    return {
      code: tp.tier.code,
      name: tp.tier.name,
      hits: h,
      observedRate: h / td,
      theoreticalRate: tp.probabilityValue,
      expectedHits: td * tp.probabilityValue,
      ci95: { low: ci.low, high: ci.high },
      consistent: tp.probabilityValue >= ci.low && tp.probabilityValue <= ci.high,
    };
  });
  const net = meanInterval(netPerDraw);
  const anyCi = wilsonInterval(drawsAny, draws);
  return {
    seed,
    draws,
    ticketsPerDraw: tickets.length,
    ticketDraws: td,
    tiers,
    anyPrize: { ticketHits: anyTicket, drawsWithAnyPrize: drawsAny, drawRate: drawsAny / draws, ci95: { low: anyCi.low, high: anyCi.high } },
    matchHistogram: hist.map((count, matches) => ({ matches, count })),
    finance: {
      totalCost: cost * draws,
      totalFixedPrizes: fixed,
      jackpotHits: jackpots,
      netPerDraw: { mean: net.mean, low: net.low, high: net.high },
      roiFixedOnly: (fixed - cost * draws) / (cost * draws),
    },
    notes: [
      'Kỳ quay được mô phỏng đồng đều theo thể lệ; kết quả là ước lượng ngẫu nhiên có khoảng tin cậy 95% (Wilson).',
      'Tài chính chỉ tính giải cố định; số lần trúng Jackpot được báo riêng vì giá trị Jackpot biến động.',
      `Không gian: ${mainPoolSize(rules)} số chính${specialPoolSize(rules) ? `, ${specialPoolSize(rules)} số đặc biệt` : ''}.`,
    ],
  };
}
