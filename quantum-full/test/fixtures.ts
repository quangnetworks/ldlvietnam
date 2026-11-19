/** Cấu hình game dùng trong test — trùng với seed migration (0002). */
import type { GameRules } from '../src/shared/game';
import type { DrawRecord } from '../src/engine/types';
import { createRng } from '../src/engine/rng';
import { simulateDraw } from '../src/engine/montecarlo';

export const LOTTO535: GameRules = {
  mainMin: 1, mainMax: 35, mainPicks: 5, specialMode: 'separate_pool', specialMin: 1, specialMax: 12, ticketPrice: 10000,
  prizeTiers: [
    { code: 'jackpot', name: 'Độc đắc', mainMatches: 5, specialMatch: true, kind: 'jackpot', amount: 6_000_000_000, shared: true },
    { code: 'first', name: 'Giải Nhất', mainMatches: 5, specialMatch: false, kind: 'fixed', amount: 10_000_000, shared: false },
    { code: 'second', name: 'Giải Nhì', mainMatches: 4, specialMatch: true, kind: 'fixed', amount: 5_000_000, shared: false },
    { code: 'third', name: 'Giải Ba', mainMatches: 4, specialMatch: false, kind: 'fixed', amount: 500_000, shared: false },
    { code: 'fourth', name: 'Giải Tư', mainMatches: 3, specialMatch: true, kind: 'fixed', amount: 100_000, shared: false },
    { code: 'fifth', name: 'Giải Năm', mainMatches: 3, specialMatch: false, kind: 'fixed', amount: 30_000, shared: false },
    { code: 'consolation_2', name: 'Khuyến khích (2 số + ĐB)', mainMatches: 2, specialMatch: true, kind: 'fixed', amount: 10_000, shared: false },
    { code: 'consolation_1', name: 'Khuyến khích (1 số + ĐB)', mainMatches: 1, specialMatch: true, kind: 'fixed', amount: 10_000, shared: false },
    { code: 'consolation_0', name: 'Khuyến khích (0 số + ĐB)', mainMatches: 0, specialMatch: true, kind: 'fixed', amount: 10_000, shared: false },
  ],
};

export const POWER655: GameRules = {
  mainMin: 1, mainMax: 55, mainPicks: 6, specialMode: 'bonus_from_main', specialMin: null, specialMax: null, ticketPrice: 10000,
  prizeTiers: [
    { code: 'jackpot1', name: 'Jackpot 1', mainMatches: 6, specialMatch: null, kind: 'jackpot', amount: 30_000_000_000, shared: true },
    { code: 'jackpot2', name: 'Jackpot 2', mainMatches: 5, specialMatch: true, kind: 'jackpot', amount: 3_000_000_000, shared: true },
    { code: 'first', name: 'Giải Nhất', mainMatches: 5, specialMatch: false, kind: 'fixed', amount: 40_000_000, shared: false },
    { code: 'second', name: 'Giải Nhì', mainMatches: 4, specialMatch: null, kind: 'fixed', amount: 500_000, shared: false },
    { code: 'third', name: 'Giải Ba', mainMatches: 3, specialMatch: null, kind: 'fixed', amount: 50_000, shared: false },
  ],
};

/**
 * Lịch sử quay TỔNG HỢP chỉ dùng cho kiểm thử thuật toán (sinh đồng đều với seed cố định).
 * KHÔNG phải dữ liệu thật và không bao giờ được nạp vào database production.
 */
export function syntheticDraws(rules: GameRules, count: number, seed = 'test-fixture'): DrawRecord[] {
  const rng = createRng(seed);
  const start = Date.UTC(2024, 0, 1);
  return Array.from({ length: count }, (_, i) => {
    const d = simulateDraw(rules, rng);
    return { id: i + 1, drawCode: String(i + 1).padStart(5, '0'), drawAt: new Date(start + i * 86400000).toISOString(), main: d.main, special: d.special };
  });
}
