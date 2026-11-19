/**
 * Kiểm tra hợp lệ bộ số, kết quả quay và ngân sách theo cấu hình game.
 */
import type { GameRules } from '../shared/game';
import { playerPicksSpecial } from '../shared/game';
import type { Ticket } from './types';

export interface ValidationIssue {
  code: string;
  message: string;
}

function isInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x);
}

export function findDuplicates(nums: number[]): number[] {
  const seen = new Set<number>();
  const dup = new Set<number>();
  for (const n of nums) (seen.has(n) ? dup : seen).add(n);
  return [...dup].sort((a, b) => a - b);
}

export function validateMainNumbers(rules: GameRules, main: unknown[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (main.length !== rules.mainPicks) issues.push({ code: 'main_count', message: `Cần đúng ${rules.mainPicks} số chính, nhận ${main.length}` });
  for (const x of main) {
    if (!isInt(x)) issues.push({ code: 'main_not_integer', message: `Giá trị "${String(x)}" không phải số nguyên` });
    else if (x < rules.mainMin || x > rules.mainMax) issues.push({ code: 'main_out_of_range', message: `Số ${x} ngoài miền ${rules.mainMin}–${rules.mainMax}` });
  }
  const dups = findDuplicates(main.filter(isInt));
  if (dups.length) issues.push({ code: 'main_duplicate', message: `Số bị trùng: ${dups.join(', ')}` });
  return issues;
}

/** Kiểm tra bộ số của VÉ (người chơi chọn). */
export function validateTicket(rules: GameRules, t: { main: unknown[]; special?: unknown }): ValidationIssue[] {
  const issues = validateMainNumbers(rules, t.main);
  const sp = t.special ?? null;
  if (playerPicksSpecial(rules)) {
    if (!isInt(sp)) issues.push({ code: 'special_missing', message: 'Thiếu số đặc biệt' });
    else if (sp < (rules.specialMin as number) || sp > (rules.specialMax as number))
      issues.push({ code: 'special_out_of_range', message: `Số đặc biệt ${sp} ngoài miền ${rules.specialMin}–${rules.specialMax}` });
  } else if (sp !== null) {
    issues.push({ code: 'special_not_allowed', message: 'Game này người chơi không chọn số đặc biệt' });
  }
  return issues;
}

/** Kiểm tra KẾT QUẢ QUAY. */
export function validateDrawResult(rules: GameRules, d: { main: unknown[]; special?: unknown }): ValidationIssue[] {
  const issues = validateMainNumbers(rules, d.main);
  const sp = d.special ?? null;
  switch (rules.specialMode) {
    case 'none':
      if (sp !== null) issues.push({ code: 'special_not_allowed', message: 'Game không có số đặc biệt' });
      break;
    case 'separate_pool':
      if (!isInt(sp)) issues.push({ code: 'special_missing', message: 'Thiếu số đặc biệt' });
      else if (sp < (rules.specialMin as number) || sp > (rules.specialMax as number))
        issues.push({ code: 'special_out_of_range', message: `Số đặc biệt ${sp} ngoài miền ${rules.specialMin}–${rules.specialMax}` });
      break;
    case 'bonus_from_main':
      if (!isInt(sp)) issues.push({ code: 'special_missing', message: 'Thiếu số đặc biệt' });
      else if (sp < rules.mainMin || sp > rules.mainMax) issues.push({ code: 'special_out_of_range', message: `Số đặc biệt ${sp} ngoài miền ${rules.mainMin}–${rules.mainMax}` });
      else if (d.main.includes(sp)) issues.push({ code: 'special_duplicates_main', message: `Số đặc biệt ${sp} trùng với số chính` });
      break;
  }
  return issues;
}

export function ticketKey(t: Ticket): string {
  return `${[...t.main].sort((a, b) => a - b).join('-')}|${t.special ?? ''}`;
}

export function findDuplicateTickets(tickets: Ticket[]): number[] {
  const seen = new Map<string, number>();
  const dups: number[] = [];
  tickets.forEach((t, i) => {
    const k = ticketKey(t);
    if (seen.has(k)) dups.push(i);
    else seen.set(k, i);
  });
  return dups;
}

export interface BudgetCheck {
  ok: boolean;
  ticketCount: number;
  totalCost: number;
  budget: number;
  maxTickets: number;
  issues: ValidationIssue[];
}

/**
 * Kiểm tra ngân sách: tổng chi phí = số vé × giá vé, không được vượt ngân sách yêu cầu
 * và không được vượt hạn mức mỗi kỳ (capital control).
 */
export function checkBudget(ticketPrice: number, ticketCount: number, budget: number, perDrawLimit?: number): BudgetCheck {
  const issues: ValidationIssue[] = [];
  if (!isInt(ticketCount) || ticketCount < 1) issues.push({ code: 'ticket_count', message: 'Số vé phải là số nguyên ≥ 1' });
  if (!isInt(budget) || budget < 0) issues.push({ code: 'budget_invalid', message: 'Ngân sách phải là số nguyên không âm (VND)' });
  const totalCost = ticketCount * ticketPrice;
  if (totalCost > budget) issues.push({ code: 'over_budget', message: `Tổng chi phí ${totalCost.toLocaleString('vi-VN')}đ vượt ngân sách ${budget.toLocaleString('vi-VN')}đ` });
  if (perDrawLimit !== undefined && totalCost > perDrawLimit)
    issues.push({ code: 'over_draw_limit', message: `Tổng chi phí vượt hạn mức mỗi kỳ ${perDrawLimit.toLocaleString('vi-VN')}đ` });
  return { ok: issues.length === 0, ticketCount, totalCost, budget, maxTickets: Math.floor(Math.min(budget, perDrawLimit ?? Infinity) / ticketPrice), issues };
}
