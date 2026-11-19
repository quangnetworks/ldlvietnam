/**
 * Capital Control: ngân sách cố định, không Martingale, không tự động mua vé.
 * Chỉ ghi nhận giao dịch MUA THỰC TẾ do người dùng tự thực hiện bên ngoài hệ thống.
 */
import { getCapitalSettings } from '../db/settings';

export interface CapitalSummary {
  mode: 'real' | 'simulated';
  totalInvestment: number;
  totalPrizes: number;
  adjustments: number;
  netResult: number;
  roi: number | null;
  drawsPlayed: number;
  costPerDraw: number | null;
  budgetPerDraw: number;
  monthlyBudget: number;
  annualBudget: number;
  monthSpent: number;
  yearSpent: number;
  monthRemaining: number;
  yearRemaining: number;
  monthly: { month: string; investment: number; prizes: number; net: number }[];
  principles: string[];
}

export function vnToday(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

export async function capitalSummary(db: D1Database, mode: 'real' | 'simulated', today = vnToday()): Promise<CapitalSummary> {
  const s = await getCapitalSettings(db);
  const tot = await db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN entry_type = 'purchase' THEN -amount END), 0) AS inv,
        COALESCE(SUM(CASE WHEN entry_type = 'prize' THEN amount END), 0) AS prizes,
        COALESCE(SUM(CASE WHEN entry_type = 'adjustment' THEN amount END), 0) AS adj,
        COUNT(DISTINCT CASE WHEN entry_type = 'purchase' THEN COALESCE(draw_id, portfolio_id) END) AS draws
       FROM bankroll_ledger WHERE mode = ?`,
    )
    .bind(mode)
    .first<{ inv: number; prizes: number; adj: number; draws: number }>();
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const spent = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN substr(entry_date, 1, 7) = ? THEN -amount END), 0) AS m, COALESCE(SUM(CASE WHEN substr(entry_date, 1, 4) = ? THEN -amount END), 0) AS y
       FROM bankroll_ledger WHERE mode = ? AND entry_type = 'purchase'`,
    )
    .bind(month, year, mode)
    .first<{ m: number; y: number }>();
  const { results } = await db
    .prepare(
      `SELECT substr(entry_date, 1, 7) AS month,
        COALESCE(SUM(CASE WHEN entry_type = 'purchase' THEN -amount END), 0) AS inv,
        COALESCE(SUM(CASE WHEN entry_type = 'prize' THEN amount END), 0) AS prizes,
        COALESCE(SUM(amount), 0) AS net
       FROM bankroll_ledger WHERE mode = ? GROUP BY month ORDER BY month DESC LIMIT 12`,
    )
    .bind(mode)
    .all<{ month: string; inv: number; prizes: number; net: number }>();
  const inv = tot?.inv ?? 0;
  const prizes = tot?.prizes ?? 0;
  const adj = tot?.adj ?? 0;
  const draws = tot?.draws ?? 0;
  return {
    mode,
    totalInvestment: inv,
    totalPrizes: prizes,
    adjustments: adj,
    netResult: prizes - inv + adj,
    roi: inv > 0 ? (prizes + adj - inv) / inv : null,
    drawsPlayed: draws,
    costPerDraw: draws > 0 ? inv / draws : null,
    budgetPerDraw: s.budgetPerDraw,
    monthlyBudget: s.monthlyBudget,
    annualBudget: s.annualBudget,
    monthSpent: spent?.m ?? 0,
    yearSpent: spent?.y ?? 0,
    monthRemaining: Math.max(0, s.monthlyBudget - (spent?.m ?? 0)),
    yearRemaining: Math.max(0, s.annualBudget - (spent?.y ?? 0)),
    monthly: results.reverse().map((r) => ({ month: r.month, investment: r.inv, prizes: r.prizes, net: r.net })),
    principles: [
      'Ngân sách cố định mỗi kỳ — không tăng vốn sau khi thua (không Martingale).',
      'Hệ thống KHÔNG tự động mua vé; chỉ ghi nhận giao dịch bạn tự thực hiện.',
      'Không vay tiền để chơi. Không vượt hạn mức đã cài đặt.',
      'Kỳ vọng toán học của mỗi vé là âm: hãy xem đây là chi phí giải trí.',
    ],
  };
}

/** Kiểm tra hạn mức trước khi ghi nhận một giao dịch mua thực tế. */
export async function checkRealPurchaseLimits(db: D1Database, gameId: number, cost: number, drawDate: string, purchaseDate: string): Promise<string[]> {
  const s = await getCapitalSettings(db);
  const issues: string[] = [];
  if (cost > s.budgetPerDraw) issues.push(`Chi phí ${cost.toLocaleString('vi-VN')}đ vượt ngân sách mỗi kỳ ${s.budgetPerDraw.toLocaleString('vi-VN')}đ`);
  const sameDraw = await db
    .prepare(
      `SELECT COALESCE(SUM(-l.amount), 0) AS v FROM bankroll_ledger l JOIN portfolios p ON p.id = l.portfolio_id
       WHERE l.mode = 'real' AND l.entry_type = 'purchase' AND p.game_id = ? AND p.target_draw_date = ?`,
    )
    .bind(gameId, drawDate)
    .first<{ v: number }>();
  if ((sameDraw?.v ?? 0) + cost > s.budgetPerDraw) issues.push(`Tổng chi cho kỳ quay ngày ${drawDate} của game này sẽ vượt ngân sách mỗi kỳ`);
  const spent = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN substr(entry_date, 1, 7) = ? THEN -amount END), 0) AS m, COALESCE(SUM(CASE WHEN substr(entry_date, 1, 4) = ? THEN -amount END), 0) AS y
       FROM bankroll_ledger WHERE mode = 'real' AND entry_type = 'purchase'`,
    )
    .bind(purchaseDate.slice(0, 7), purchaseDate.slice(0, 4))
    .first<{ m: number; y: number }>();
  if ((spent?.m ?? 0) + cost > s.monthlyBudget) issues.push(`Vượt hạn mức tháng ${s.monthlyBudget.toLocaleString('vi-VN')}đ`);
  if ((spent?.y ?? 0) + cost > s.annualBudget) issues.push(`Vượt hạn mức năm ${s.annualBudget.toLocaleString('vi-VN')}đ`);
  return issues;
}
