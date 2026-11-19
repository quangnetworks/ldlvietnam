/**
 * Chấm vé so với kết quả quay, theo cấu hình hạng giải của game.
 */
import type { GameRules, PrizeTier } from '../shared/game';
import { tierForOutcome } from './probability';
import type { Ticket } from './types';

export interface TicketEvaluation {
  mainMatches: number;
  specialMatched: boolean;
  tier: PrizeTier | null;
  /** Giá trị giải cố định; null nếu là jackpot (giá trị thực tế phải nhập từ kết quả chính thức). */
  prizeAmount: number | null;
}

export function countMainMatches(ticketMain: number[], drawMain: number[]): number {
  const s = new Set(drawMain);
  let c = 0;
  for (const x of ticketMain) if (s.has(x)) c++;
  return c;
}

export function isSpecialMatched(rules: GameRules, ticket: Ticket, drawMain: number[], drawSpecial: number | null): boolean {
  if (drawSpecial == null) return false;
  switch (rules.specialMode) {
    case 'none':
      return false;
    case 'separate_pool':
      return ticket.special === drawSpecial;
    case 'bonus_from_main':
      // Số đặc biệt nằm trong các số của vé nhưng không phải số chính đã trùng.
      return ticket.main.includes(drawSpecial) && !drawMain.includes(drawSpecial);
  }
}

export function evaluateTicket(rules: GameRules, ticket: Ticket, drawMain: number[], drawSpecial: number | null): TicketEvaluation {
  const mainMatches = countMainMatches(ticket.main, drawMain);
  const specialMatched = isSpecialMatched(rules, ticket, drawMain, drawSpecial);
  const tier = tierForOutcome(rules, mainMatches, specialMatched);
  return { mainMatches, specialMatched, tier, prizeAmount: tier ? (tier.kind === 'fixed' ? tier.amount : null) : 0 };
}
