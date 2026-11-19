/**
 * Draw Tracking: chấm các danh mục vé với kết quả quay ĐÃ XÁC MINH và ghi sổ quỹ.
 */
import type { Context } from 'hono';
import { evaluateTicket } from '../../engine/prize';
import { getDraw } from '../db/draws';
import { getGame } from '../db/games';
import { auditStatement } from '../lib/audit';
import { nowIso } from '../lib/http';
import type { AppEnv } from '../lib/types';

export interface PortfolioRow {
  id: number;
  game_id: number;
  recommendation_id: number | null;
  name: string;
  mode: 'simulated' | 'real';
  status: 'draft' | 'purchased' | 'evaluated' | 'cancelled';
  target_draw_date: string | null;
  target_draw_time: string | null;
  target_draw_id: number | null;
  ticket_count: number;
  total_cost: number;
  purchased_at: string | null;
  created_at: string;
}

export async function loadPortfolioTickets(db: D1Database, portfolioId: number) {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.ticket_index, t.special_number, t.cost,
        (SELECT group_concat(number, ',') FROM (SELECT number FROM ticket_numbers tn WHERE tn.ticket_id = t.id ORDER BY position)) AS numbers,
        r.main_matches, r.special_matched, r.prize_tier_code, r.prize_amount, r.draw_id
       FROM tickets t LEFT JOIN ticket_results r ON r.ticket_id = t.id WHERE t.portfolio_id = ? ORDER BY t.ticket_index`,
    )
    .bind(portfolioId)
    .all<{ id: number; ticket_index: number; special_number: number | null; cost: number; numbers: string; main_matches: number | null; special_matched: number | null; prize_tier_code: string | null; prize_amount: number | null; draw_id: number | null }>();
  return results.map((r) => ({
    id: r.id,
    index: r.ticket_index,
    main: r.numbers.split(',').map(Number),
    special: r.special_number,
    cost: r.cost,
    result: r.draw_id == null ? null : { drawId: r.draw_id, mainMatches: r.main_matches, specialMatched: r.special_matched === 1, prizeTier: r.prize_tier_code, prizeAmount: r.prize_amount },
  }));
}

export async function findTargetDraw(db: D1Database, p: PortfolioRow): Promise<number | null> {
  if (p.target_draw_id) return p.target_draw_id;
  if (!p.target_draw_date) return null;
  const { results } = await db
    .prepare(
      `SELECT id FROM draws WHERE game_id = ? AND draw_date = ? AND verification_status = 'verified' AND (? IS NULL OR draw_time = ?) ORDER BY draw_at`,
    )
    .bind(p.game_id, p.target_draw_date, p.target_draw_time, p.target_draw_time)
    .all<{ id: number }>();
  return results.length === 1 ? results[0].id : null;
}

export async function evaluatePortfolio(c: Context<AppEnv>, p: PortfolioRow): Promise<{ evaluated: boolean; reason?: string; drawId?: number; fixedPrize?: number; jackpotTiers?: string[] }> {
  const db = c.env.DB;
  if (p.status === 'cancelled') return { evaluated: false, reason: 'Danh mục đã huỷ' };
  if (p.status === 'evaluated') return { evaluated: false, reason: 'Đã chấm trước đó' };
  if (p.mode === 'real' && p.status !== 'purchased') return { evaluated: false, reason: 'Danh mục thực tế chưa ghi nhận mua vé' };
  const drawId = await findTargetDraw(db, p);
  if (!drawId) return { evaluated: false, reason: 'Chưa có kết quả ĐÃ XÁC MINH khớp ngày/giờ quay mục tiêu (hoặc có nhiều kỳ cùng ngày — hãy chọn giờ quay)' };
  const draw = await getDraw(db, drawId);
  if (!draw || draw.verificationStatus !== 'verified') return { evaluated: false, reason: 'Kết quả chưa xác minh' };
  const game = await getGame(db, p.game_id);
  const tickets = await loadPortfolioTickets(db, p.id);
  const stmts: D1PreparedStatement[] = [];
  let fixed = 0;
  const jackpots: string[] = [];
  for (const t of tickets) {
    const ev = evaluateTicket(game, { main: t.main, special: t.special }, draw.main, draw.special);
    if (ev.tier?.kind === 'fixed') fixed += ev.tier.amount;
    if (ev.tier?.kind === 'jackpot') jackpots.push(ev.tier.name);
    stmts.push(
      db.prepare('INSERT INTO ticket_results (ticket_id, draw_id, main_matches, special_matched, prize_tier_code, prize_amount) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(ticket_id, draw_id) DO NOTHING').bind(
        t.id, drawId, ev.mainMatches, ev.specialMatched ? 1 : 0, ev.tier?.code ?? null, ev.prizeAmount,
      ),
    );
  }
  const ts = nowIso();
  stmts.push(db.prepare("UPDATE portfolios SET status = 'evaluated', target_draw_id = ?, updated_at = ? WHERE id = ?").bind(drawId, ts, p.id));
  const user = c.get('user');
  if (p.mode === 'simulated') {
    stmts.push(
      db.prepare("INSERT INTO bankroll_ledger (entry_type, mode, amount, game_id, portfolio_id, draw_id, entry_date, note, created_by) VALUES ('purchase', 'simulated', ?, ?, ?, ?, ?, ?, ?)").bind(
        -p.total_cost, p.game_id, p.id, drawId, draw.drawDate, `Mô phỏng: ${p.name}`, user.id,
      ),
    );
  }
  if (fixed > 0) {
    stmts.push(
      db.prepare("INSERT INTO bankroll_ledger (entry_type, mode, amount, game_id, portfolio_id, draw_id, entry_date, note, created_by) VALUES ('prize', ?, ?, ?, ?, ?, ?, ?, ?)").bind(
        p.mode, fixed, p.game_id, p.id, drawId, draw.drawDate, `Giải cố định kỳ ${draw.drawCode}`, user.id,
      ),
    );
  }
  stmts.push(auditStatement(c, { action: 'portfolios.evaluate', entityType: 'portfolio', entityId: p.id, after: { drawId, fixedPrize: fixed, jackpotTiers: jackpots } }));
  await db.batch(stmts);
  return { evaluated: true, drawId, fixedPrize: fixed, jackpotTiers: jackpots };
}
