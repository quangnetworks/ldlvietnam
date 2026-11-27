import { Hono } from 'hono';
import { z } from 'zod';
import { BINGO_STAKE, OFFICIAL_PAYTABLE, analyzeBet, betCatalog, betLabel, bingoModels, bingoStatistics, exactSumCounts, simulateSessions, type BingoBet, type BingoResult } from '../../engine/bingo18';
import { daysLeftInMonth, evaluateTicketValue, vnClock } from '../../engine/decision';
import { REGION_CODES, regionValue } from '../../engine/xskt';
import { listGames } from '../db/games';
import { randomSeed } from '../../engine/rng';
import { getAnyGame } from '../db/games';
import { insertModelRun } from '../db/models';
import { getSetting } from '../db/settings';
import { auditStatement } from '../lib/audit';
import { cached } from '../lib/cache';
import { ApiError, PaginationQuery, nowIso, pageMeta, parseJson, parseQuery } from '../lib/http';
import { rateLimit } from '../lib/observability';
import type { AppEnv } from '../lib/types';
import { capitalSummary } from '../services/capital';

export const bingoRoutes = new Hono<AppEnv>();

const BetSchema = z.object({ type: z.enum(['single', 'pair', 'triple', 'any_triple', 'sum', 'big', 'small', 'draw']), value: z.number().int().optional() });

const ratio = (r: ReturnType<typeof analyzeBet>) => ({ ...r, winProbability: `${r.winProbability.num}/${r.winProbability.den}` });

bingoRoutes.get('/bingo18/rules', async (c) => {
  const game = await getAnyGame(c.env.DB, 'bingo18');
  const catalog = betCatalog().map(ratio);
  return c.json({
    data: {
      game: { code: game.code, name: game.name, ticketPrice: game.ticketPrice, scheduleNote: game.scheduleNote, rulesSourceUrl: game.rulesSourceUrl, rulesNote: game.rulesNote, rulesVerificationStatus: game.rulesVerificationStatus },
      paytable: OFFICIAL_PAYTABLE,
      outcomes: 216,
      exactSumCounts: exactSumCounts(),
      catalog,
      bestReturn: catalog.reduce((a, b) => (b.returnRatio > a.returnRatio ? b : a)),
      note: 'Mọi cược đều có tỷ lệ hoàn trả kỳ vọng dưới 100% (khoảng 50 đến 57%): chơi càng nhiều, kết quả càng tiến về mức lỗ kỳ vọng.',
    },
  });
});

const DrawsQuery = PaginationQuery.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), status: z.enum(['unverified', 'verified', 'rejected']).optional() });

bingoRoutes.get('/bingo18/draws', async (c) => {
  const q = parseQuery(c, DrawsQuery);
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.date) (where.push('draw_date = ?'), binds.push(q.date));
  if (q.status) (where.push('verification_status = ?'), binds.push(q.status));
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM bingo18_draws ${w}`).bind(...binds).first<{ n: number }>())!.n;
  const { results } = await c.env.DB.prepare(`SELECT id, draw_code, draw_date, d1, d2, d3, total, verification_status, import_job_id FROM bingo18_draws ${w} ORDER BY CAST(draw_code AS INTEGER) DESC LIMIT ? OFFSET ?`)
    .bind(...binds, q.page_size, (q.page - 1) * q.page_size)
    .all();
  const counts = await c.env.DB.prepare('SELECT verification_status AS s, COUNT(*) AS n, MIN(draw_date) AS first, MAX(draw_date) AS last FROM bingo18_draws GROUP BY verification_status').all<{ s: string; n: number; first: string; last: string }>();
  return c.json({ data: results, meta: { ...pageMeta(q.page, q.page_size, total), statusCounts: Object.fromEntries(counts.results.map((r) => [r.s, r.n])), range: { first: counts.results.map((r) => r.first).sort()[0] ?? null, last: counts.results.map((r) => r.last).sort().at(-1) ?? null } } });
});

const StatsQuery = z.object({ last: z.coerce.number().int().min(50).max(50000).default(10000), include_unverified: z.enum(['true', 'false']).optional() });

bingoRoutes.get('/bingo18/statistics', async (c) => {
  const q = parseQuery(c, StatsQuery);
  const inc = q.include_unverified === 'true';
  const { results } = await c.env.DB.prepare(
    `SELECT d1, d2, d3, draw_code, draw_date FROM bingo18_draws WHERE verification_status ${inc ? "IN ('verified','unverified')" : "= 'verified'"} ORDER BY CAST(draw_code AS INTEGER) DESC LIMIT ?`,
  )
    .bind(q.last)
    .all<{ d1: number; d2: number; d3: number; draw_code: string; draw_date: string }>();
  results.reverse();
  const stats = bingoStatistics(results.map((r) => [r.d1, r.d2, r.d3] as BingoResult));
  return c.json({
    data: { ...stats, range: { from: results[0]?.draw_date ?? null, to: results.at(-1)?.draw_date ?? null, firstCode: results[0]?.draw_code ?? null, lastCode: results.at(-1)?.draw_code ?? null } },
    meta: { includeUnverified: inc, dataNotice: inc ? 'Có bao gồm dữ liệu CHƯA XÁC MINH.' : 'Chỉ dùng dữ liệu đã xác minh.' },
  });
});

const ModelsQuery = z.object({
  last: z.coerce.number().int().min(1000).max(100000).default(30000),
  window: z.coerce.number().int().min(10).max(2000).default(100),
  include_unverified: z.enum(['true', 'false']).optional(),
});

async function loadResults(db: D1Database, last: number, includeUnverified: boolean) {
  const { results } = await db
    .prepare(`SELECT d1, d2, d3 FROM bingo18_draws WHERE verification_status ${includeUnverified ? "IN ('verified','unverified')" : "= 'verified'"} ORDER BY CAST(draw_code AS INTEGER) DESC LIMIT ?`)
    .bind(last)
    .all<{ d1: number; d2: number; d3: number }>();
  return results.reverse().map((r) => [r.d1, r.d2, r.d3] as BingoResult);
}

async function bingoFingerprint(db: D1Database, includeUnverified: boolean): Promise<string> {
  const r = await db
    .prepare(`SELECT COUNT(*) AS n, MAX(CAST(draw_code AS INTEGER)) AS hi FROM bingo18_draws WHERE verification_status ${includeUnverified ? "IN ('verified','unverified')" : "= 'verified'"}`)
    .first<{ n: number; hi: number | null }>();
  return `${r?.n ?? 0}:${r?.hi ?? 0}`;
}

/** Mô hình dự báo Bingo18 chấm walk-forward (cùng khung XSKT), lưu đệm theo dữ liệu. */
export async function bingoModelsCached(db: D1Database, q: { last: number; window: number; includeUnverified: boolean }) {
  const fp = await bingoFingerprint(db, q.includeUnverified);
  return cached(db, `bingo18:models:${q.last}:${q.window}:${q.includeUnverified ? 'all' : 'verified'}`, fp, async () => bingoModels(await loadResults(db, q.last, q.includeUnverified), { window: q.window }));
}

bingoRoutes.get('/bingo18/models', rateLimit(3), async (c) => {
  const q = parseQuery(c, ModelsQuery);
  const inc = q.include_unverified === 'true';
  const r = await bingoModelsCached(c.env.DB, { last: q.last, window: q.window, includeUnverified: inc });
  return c.json({ data: r.result, meta: { cached: r.cached, computedAt: r.computedAt, includeUnverified: inc, dataNotice: inc ? 'Có bao gồm dữ liệu CHƯA XÁC MINH.' : 'Chỉ dùng dữ liệu đã xác minh.' } });
});

const SimBody = z.object({
  bets: z.array(z.object({ bet: BetSchema, stakeUnits: z.number().int().min(1).max(100) })).min(1).max(10),
  drawsPerSession: z.number().int().min(1).max(200),
  sessions: z.number().int().min(10).max(20000),
  stopLoss: z.number().int().min(0).max(100_000_000).optional(),
  seed: z.string().min(1).max(64).regex(/^[\w.\-:]+$/).nullable().optional(),
});

bingoRoutes.post('/bingo18/simulate', rateLimit(5), async (c) => {
  const b = await parseJson(c, SimBody);
  const seed = b.seed ?? randomSeed();
  let r;
  try {
    r = simulateSessions({ bets: b.bets as { bet: BingoBet; stakeUnits: number }[], drawsPerSession: b.drawsPerSession, sessions: b.sessions, stopLoss: b.stopLoss || undefined, seed });
  } catch (e) {
    throw new ApiError(422, 'model_input', (e as Error).message);
  }
  const game = await getAnyGame(c.env.DB, 'bingo18');
  const run = await insertModelRun(c.env.DB, { modelCode: 'bingo18_analysis', gameId: game.id, runType: 'montecarlo', params: { ...b, seed }, seed, draws: [], output: { meanNet: r.meanNet, probabilityProfit: r.probabilityProfit, percentiles: r.percentiles }, durationMs: 0, createdBy: c.get('user').id });
  return c.json({ data: { ...r, seed, modelRunId: run.id, bets: b.bets.map((x) => ({ ...x, label: betLabel(x.bet as BingoBet) })) } }, 201);
});

/** Số kỳ Bingo18 còn lại hôm nay theo lịch 6 phút/kỳ từ 06:00 đến 21:53. */
export function bingoDrawsRemaining(nowIso: string): { remaining: number; nextAt: string | null; perDay: number } {
  const { minutes } = vnClock(nowIso);
  const start = 6 * 60;
  const end = 21 * 60 + 53;
  const perDay = Math.floor((end - start) / 6) + 1;
  let remaining = 0;
  let next: number | null = null;
  for (let t = start; t <= end; t += 6) {
    if (t - 1 > minutes) {
      remaining++;
      if (next === null) next = t;
    }
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return { remaining, nextAt: next === null ? null : `${pad(Math.floor(next / 60))}:${pad(next % 60)}`, perDay };
}

bingoRoutes.get('/bingo18/decision', async (c) => {
  const q = parseQuery(c, z.object({ now: z.iso.datetime().optional() }));
  const now = q.now ?? nowIso();
  const db = c.env.DB;
  const game = await getAnyGame(db, 'bingo18');
  const [capital, dailyLimit, sessionMinutes] = await Promise.all([capitalSummary(db, 'real'), getSetting<number>(db, 'bingo18_daily_limit', 50000), getSetting<number>(db, 'bingo18_session_minutes', 30)]);
  const today = vnClock(now).date;
  const spent = await db
    .prepare("SELECT COALESCE(SUM(CASE WHEN entry_type = 'purchase' THEN -amount END), 0) AS spent, COALESCE(SUM(CASE WHEN entry_type = 'prize' THEN amount END), 0) AS won FROM bingo18_ledger_view WHERE entry_date = ?")
    .bind(today)
    .first<{ spent: number; won: number }>()
    .catch(() => null);
  const spentToday = spent?.spent ?? 0;
  const daysLeft = daysLeftInMonth(today);
  const available = Math.max(0, Math.min(dailyLimit, Math.floor(capital.monthRemaining / daysLeft), capital.yearRemaining) - spentToday);
  const best = betCatalog().reduce((a, b) => (b.returnRatio > a.returnRatio ? b : a));
  const schedule = bingoDrawsRemaining(now);
  const plays = Math.min(Math.floor(available / BINGO_STAKE), schedule.remaining);
  const reasons: string[] = [];
  let action: 'play' | 'skip' = 'play';
  let headline: string;
  if (schedule.remaining === 0) {
    action = 'skip';
    headline = 'KHÔNG CHƠI: HẾT KỲ QUAY HÔM NAY';
    reasons.push('Bingo18 quay từ 06:00 đến 21:53; hôm nay không còn kỳ nào.');
  } else if (plays < 1) {
    action = 'skip';
    headline = 'KHÔNG CHƠI: ĐÃ ĐẠT HẠN MỨC';
    reasons.push(`Đã chi ${spentToday.toLocaleString('vi-VN')}đ cho Bingo18 hôm nay; hạn mức khả dụng còn ${available.toLocaleString('vi-VN')}đ.`);
  } else {
    headline = `TỐI ĐA ${plays} LƯỢT × 10.000đ, CƯỢC “${best.label.toUpperCase()}”`;
    reasons.push(`“${best.label}” có tỷ lệ hoàn trả kỳ vọng cao nhất trong các cách chơi: ${(best.returnRatio * 100).toFixed(2)}% (mọi số 1 đến 6 như nhau).`);
    reasons.push(`Ngân sách khả dụng hôm nay ${available.toLocaleString('vi-VN')}đ = min(hạn mức Bingo18/ngày, hạn mức tháng còn lại ÷ ${daysLeft} ngày, hạn mức năm) − đã chi.`);
    reasons.push(`Lỗ kỳ vọng nếu chơi hết ${plays} lượt ≈ ${Math.round(plays * (BINGO_STAKE - best.expectedPayout)).toLocaleString('vi-VN')}đ.`);
    reasons.push(`Giới hạn phiên ${sessionMinutes} phút; dừng ngay khi hết ngân sách, không cược thêm để “gỡ”.`);
  }
  const sim =
    action === 'play'
      ? simulateSessions({ bets: [{ bet: best.bet, stakeUnits: 1 }], drawsPerSession: plays, sessions: 4000, seed: `decision:${today}:${plays}` })
      : null;

  // Kết luận mô hình dự báo (walk-forward). Ưu tiên dữ liệu đã xác minh; nếu chưa đủ thì dùng cả dữ liệu chưa xác minh và ghi rõ.
  const verifiedCount = (await db.prepare("SELECT COUNT(*) AS n FROM bingo18_draws WHERE verification_status = 'verified'").first<{ n: number }>())?.n ?? 0;
  const useAll = verifiedCount < 1000;
  let model: Record<string, unknown> | null = null;
  try {
    const m = (await bingoModelsCached(db, { last: 30000, window: 100, includeUnverified: useAll })).result;
    const bestModel = m.models.filter((x) => x.code !== 'uniform').sort((a, b) => b.improvement - a.improvement)[0];
    model = { verdict: m.verdict, headline: m.headline, scoredDraws: m.scoredDraws, includeUnverified: useAll, bestModel: bestModel ? { name: bestModel.name, improvement: bestModel.improvement, qValue: bestModel.qValue, singleReturn: bestModel.single.returnRatio } : null };
    if (action === 'play') {
      if (m.verdict === 'edge') reasons.push(`Mô hình ${bestModel.name} nhỉnh hơn ngẫu nhiên trên dữ liệu cũ nhưng hoàn trả thực tế vẫn ${(bestModel.single.returnRatio * 100).toFixed(1)}% (< 100%) — không đổi kế hoạch.`);
      else if (m.verdict === 'no_edge') reasons.push(`Đã chấm ${m.scoredDraws.toLocaleString('vi-VN')} kỳ: không mô hình dự báo nào tốt hơn chọn ngẫu nhiên ⇒ chọn số nào trong 1–6 cũng như nhau.`);
    }
  } catch {
    model = null;
  }

  // So sánh giá trị kỳ vọng mỗi 10.000đ giữa các trò chơi (sau thuế), để chọn nơi chi tiền ít lỗ nhất.
  const jackpots = await getSetting<Record<string, { values: Record<string, number> }>>(db, 'current_jackpots', {});
  const pickGames = (await listGames(db)).filter((g) => g.engine === 'pick' && g.isActive);
  const bigBet = analyzeBet({ type: 'big' });
  const comparison = [
    { game: 'Bingo18', option: best.label, returnRatio: best.returnRatio, note: '6 phút/kỳ — dễ chơi quá mức' },
    { game: 'Bingo18', option: 'Lớn / Nhỏ', returnRatio: bigBet.returnRatio, note: '' },
    ...REGION_CODES.map((r) => {
      const v = regionValue(r);
      return { game: v.name, option: 'Vé 10.000đ', returnRatio: v.returnRatioAfterTax, note: 'Xổ số kiến thiết' };
    }),
    ...pickGames.map((g) => {
      const v = evaluateTicketValue({ ...g, schedule: null, jackpots: jackpots[g.code]?.values ?? {}, jackpotsUpdatedAt: null }, true);
      return { game: g.name, option: v.jackpotIsMinimum ? 'Jackpot mức tối thiểu' : 'Jackpot hiện tại', returnRatio: v.returnRatio, note: 'Kỳ “chia giải Độc đắc” (Lotto 5/35) có thể cao hơn nhiều' };
    }),
  ]
    .map((x) => ({ ...x, expectedLossPer10k: Math.round(BINGO_STAKE * (1 - x.returnRatio)) }))
    .sort((a, b) => b.returnRatio - a.returnRatio);
  return c.json({
    data: {
      action,
      headline,
      today,
      plays,
      cost: plays * BINGO_STAKE,
      bestBet: ratio(best),
      expectedLoss: plays * (BINGO_STAKE - best.expectedPayout),
      schedule,
      allowance: { dailyLimit, dailyFromMonth: Math.floor(capital.monthRemaining / daysLeft), yearRemaining: capital.yearRemaining, spentToday, wonToday: spent?.won ?? 0, available, daysLeftInMonth: daysLeft },
      outlook: sim && { probabilityProfit: sim.probabilityProfit, median: sim.percentiles.p50, p5: sim.percentiles.p5, p95: sim.percentiles.p95 },
      model,
      comparison,
      sessionMinutes,
      reasons,
      warnings: [
        'Bingo18 quay mỗi 6 phút, tần suất cao dễ dẫn tới chơi quá mức. Đặt giới hạn thời gian và số tiền trước khi bắt đầu.',
        'Kết quả các kỳ độc lập: chuỗi “Lớn” hay “Nhỏ” liên tiếp không làm thay đổi xác suất kỳ sau.',
        'Không có chiến thuật cược nào (gấp thếp, đánh đuổi…) làm tỷ lệ hoàn trả vượt ~57%.',
      ],
      game: { scheduleNote: game.scheduleNote },
    },
  });
});

const LedgerBody = z.object({
  stake: z.number().int().min(0).max(10_000_000).multipleOf(BINGO_STAKE),
  prize: z.number().int().min(0).max(1_000_000_000).default(0),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(300).optional(),
});

/** Ghi nhận chi tiêu & tiền thưởng Bingo18 THỰC TẾ (người dùng tự chơi qua kênh chính thức). Kiểm tra hạn mức. */
bingoRoutes.post('/bingo18/ledger', async (c) => {
  const b = await parseJson(c, LedgerBody);
  if (b.stake === 0 && b.prize === 0) throw new ApiError(400, 'bad_request', 'Cần nhập số tiền chơi hoặc tiền thưởng');
  const db = c.env.DB;
  const game = await getAnyGame(db, 'bingo18');
  const date = b.entry_date ?? vnClock(nowIso()).date;
  if (b.stake > 0) {
    const [capital, dailyLimit] = await Promise.all([capitalSummary(db, 'real', date), getSetting<number>(db, 'bingo18_daily_limit', 50000)]);
    const spent = await db.prepare("SELECT COALESCE(SUM(-amount), 0) AS v FROM bankroll_ledger WHERE mode = 'real' AND entry_type = 'purchase' AND game_id = ? AND entry_date = ?").bind(game.id, date).first<{ v: number }>();
    const issues: string[] = [];
    if ((spent?.v ?? 0) + b.stake > dailyLimit) issues.push(`Vượt hạn mức Bingo18 mỗi ngày ${dailyLimit.toLocaleString('vi-VN')}đ`);
    if (b.stake > capital.monthRemaining) issues.push('Vượt hạn mức tháng còn lại');
    if (b.stake > capital.yearRemaining) issues.push('Vượt hạn mức năm còn lại');
    if (issues.length) throw new ApiError(422, 'capital_limit', issues.join('; '), issues);
  }
  const user = c.get('user');
  const stmts: D1PreparedStatement[] = [];
  if (b.stake > 0)
    stmts.push(db.prepare("INSERT INTO bankroll_ledger (entry_type, mode, amount, game_id, entry_date, note, created_by) VALUES ('purchase', 'real', ?, ?, ?, ?, ?)").bind(-b.stake, game.id, date, b.note ?? 'Chơi Bingo18', user.id));
  if (b.prize > 0)
    stmts.push(db.prepare("INSERT INTO bankroll_ledger (entry_type, mode, amount, game_id, entry_date, note, created_by) VALUES ('prize', 'real', ?, ?, ?, ?, ?)").bind(b.prize, game.id, date, b.note ?? 'Thưởng Bingo18', user.id));
  stmts.push(auditStatement(c, { action: 'bingo18.ledger', entityType: 'bankroll_ledger', after: { ...b, date } }));
  await db.batch(stmts);
  return c.json({ data: { ok: true, date } }, 201);
});
