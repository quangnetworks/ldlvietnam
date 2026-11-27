import { Hono } from 'hono';
import { z } from 'zod';
import { evaluateTicketValue, type DecisionGame } from '../../engine/decision';
import { LOTTO535_SPLIT_SHARES, estimateTickets, splitDrawEV } from '../../engine/splitDraw';
import { REGIONS, REGION_CODES, numbersPerDraw, regionValue, slotTiers, xsktAudit, xsktModels, type Region, type XsktDraw } from '../../engine/xskt';
import { listGames } from '../db/games';
import { getSetting } from '../db/settings';
import { actorFromContext } from '../lib/audit';
import { requireRole } from '../lib/auth';
import { PaginationQuery, pageMeta, parseJson, parseQuery } from '../lib/http';
import { rateLimit } from '../lib/observability';
import type { AppEnv } from '../lib/types';
import { syncXskt } from '../services/xsktSync';

export const xsktRoutes = new Hono<AppEnv>();

const RegionEnum = z.enum(['mb', 'mt', 'mn']);
const DATA_NOTICE = 'Dữ liệu XSKT từ nguồn mở bên thứ ba (GitHub, MIT), trạng thái CHƯA XÁC MINH, đối chiếu kết quả chính thức của công ty XSKT khi cần.';

async function loadDraws(db: D1Database, region: Region, station?: string): Promise<XsktDraw[]> {
  const sql = `SELECT station, draw_date, numbers_json FROM xskt_draws WHERE region = ?${station ? ' AND station = ?' : ''} ORDER BY draw_date, station`;
  const { results } = await db.prepare(sql).bind(...(station ? [region, station] : [region])).all<{ station: string; draw_date: string; numbers_json: string }>();
  return results.map((r) => ({ station: r.station, date: r.draw_date, numbers: JSON.parse(r.numbers_json) as string[] }));
}

async function fingerprint(db: D1Database, region: Region, station?: string): Promise<string> {
  const r = await db
    .prepare(`SELECT COUNT(*) AS n, MAX(draw_date) AS d FROM xskt_draws WHERE region = ?${station ? ' AND station = ?' : ''}`)
    .bind(...(station ? [region, station] : [region]))
    .first<{ n: number; d: string | null }>();
  return `${r?.n ?? 0}:${r?.d ?? ''}`;
}

/** Kết quả phân tích nặng được lưu đệm theo fingerprint dữ liệu; tính lại khi có kỳ mới. */
async function cached<T>(db: D1Database, key: string, fp: string, compute: () => Promise<T>): Promise<{ result: T; cached: boolean; computedAt: string }> {
  const row = await db.prepare('SELECT fingerprint, result_json, computed_at FROM xskt_cache WHERE cache_key = ?').bind(key).first<{ fingerprint: string; result_json: string; computed_at: string }>();
  if (row && row.fingerprint === fp) return { result: JSON.parse(row.result_json) as T, cached: true, computedAt: row.computed_at };
  const result = await compute();
  const at = new Date().toISOString();
  await db
    .prepare('INSERT INTO xskt_cache (cache_key, fingerprint, result_json, computed_at) VALUES (?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET fingerprint = excluded.fingerprint, result_json = excluded.result_json, computed_at = excluded.computed_at')
    .bind(key, fp, JSON.stringify(result), at)
    .run();
  return { result, cached: false, computedAt: at };
}

const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** Tổng quan: số kỳ, đài, lịch quay theo thứ (suy ra từ 120 ngày gần nhất), trạng thái đồng bộ. */
xsktRoutes.get('/xskt/summary', async (c) => {
  const db = c.env.DB;
  const { results } = await db
    .prepare('SELECT region, station, COUNT(*) AS n, MIN(draw_date) AS first, MAX(draw_date) AS last FROM xskt_draws GROUP BY region, station ORDER BY region, station')
    .all<{ region: Region; station: string; n: number; first: string; last: string }>();
  const recent = await db
    .prepare("SELECT region, station, draw_date FROM xskt_draws WHERE draw_date >= date((SELECT MAX(draw_date) FROM xskt_draws), '-120 day')")
    .all<{ region: Region; station: string; draw_date: string }>();
  const days = new Map<string, Set<number>>();
  for (const r of recent.results) {
    const k = `${r.region}|${r.station}`;
    if (!days.has(k)) days.set(k, new Set());
    days.get(k)!.add(new Date(`${r.draw_date}T00:00:00Z`).getUTCDay());
  }
  const sync = await getSetting<Record<string, unknown>>(db, 'xskt_sync', {});
  const regions = REGION_CODES.map((region) => {
    const st = results.filter((r) => r.region === region);
    const latest = st.reduce<string | null>((m, r) => (!m || r.last > m ? r.last : m), null);
    const schedule = WEEKDAYS.map((name, wd) => ({ weekday: wd, name, stations: st.filter((s) => days.get(`${region}|${s.station}`)?.has(wd)).map((s) => s.station) }));
    return {
      region,
      name: REGIONS[region].name,
      draws: st.reduce((s, r) => s + r.n, 0),
      latestDate: latest,
      stations: st.map((s) => ({ station: s.station, draws: s.n, firstDate: s.first, lastDate: s.last, active: !!latest && s.last >= new Date(new Date(`${latest}T00:00:00Z`).getTime() - 30 * 864e5).toISOString().slice(0, 10), weekdays: [...(days.get(`${region}|${s.station}`) ?? [])].sort() })),
      schedule,
      numbersPerDraw: numbersPerDraw(region),
    };
  });
  return c.json({ data: { regions, sync, dataNotice: DATA_NOTICE } });
});

const DrawsQuery = PaginationQuery.extend({ region: RegionEnum, station: z.string().max(64).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

xsktRoutes.get('/xskt/draws', async (c) => {
  const q = parseQuery(c, DrawsQuery);
  const where = ['region = ?'];
  const binds: unknown[] = [q.region];
  if (q.station) (where.push('station = ?'), binds.push(q.station));
  if (q.date) (where.push('draw_date = ?'), binds.push(q.date));
  const w = where.join(' AND ');
  const total = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM xskt_draws WHERE ${w}`).bind(...binds).first<{ n: number }>())!.n;
  const { results } = await c.env.DB.prepare(`SELECT id, station, draw_date, numbers_json, verification_status FROM xskt_draws WHERE ${w} ORDER BY draw_date DESC, station LIMIT ? OFFSET ?`)
    .bind(...binds, q.page_size, (q.page - 1) * q.page_size)
    .all<{ id: number; station: string; draw_date: string; numbers_json: string; verification_status: string }>();
  const tiers = slotTiers(q.region);
  const data = results.map((r) => {
    const nums = JSON.parse(r.numbers_json) as string[];
    const grouped = REGIONS[q.region].tiers.map((t) => ({ code: t.code, name: t.name, numbers: nums.filter((_, i) => tiers[i]?.code === t.code) }));
    return { id: r.id, station: r.station, date: r.draw_date, prizes: grouped, verificationStatus: r.verification_status };
  });
  return c.json({ data, meta: { ...pageMeta(q.page, q.page_size, total), dataNotice: DATA_NOTICE } });
});

const AuditQuery = z.object({ region: RegionEnum });

xsktRoutes.get('/xskt/audit', rateLimit(3), async (c) => {
  const q = parseQuery(c, AuditQuery);
  const db = c.env.DB;
  const fp = await fingerprint(db, q.region);
  const r = await cached(db, `audit:${q.region}`, fp, async () => xsktAudit(q.region, await loadDraws(db, q.region)));
  return c.json({ data: r.result, meta: { cached: r.cached, computedAt: r.computedAt, dataNotice: DATA_NOTICE } });
});

const ModelsQuery = z.object({ region: RegionEnum, station: z.string().max(64).optional(), window: z.coerce.number().int().min(5).max(365).default(30) });

xsktRoutes.get('/xskt/models', rateLimit(3), async (c) => {
  const q = parseQuery(c, ModelsQuery);
  const db = c.env.DB;
  const fp = await fingerprint(db, q.region, q.station);
  const r = await cached(db, `models:${q.region}:${q.station ?? '*'}:${q.window}`, fp, async () => xsktModels(q.region, await loadDraws(db, q.region, q.station), { window: q.window }));
  return c.json({ data: { ...r.result, station: q.station ?? null }, meta: { cached: r.cached, computedAt: r.computedAt, dataNotice: DATA_NOTICE } });
});

type JackpotStore = Record<string, { values: Record<string, number> }>;
interface SplitCfg {
  game: string;
  date: string;
  time: string;
  jackpot: number;
  tickets_override?: number | null;
  reference_winners?: Record<string, number>;
  sales_growth: number;
}

/** Giá trị một vé 10.000đ: XSKT 3 miền so với Vietlott (kỳ thường & kỳ Chia giải nếu đã cấu hình). */
xsktRoutes.get('/xskt/value', async (c) => {
  const db = c.env.DB;
  const [games, jackpots, split] = await Promise.all([listGames(db), getSetting<JackpotStore>(db, 'current_jackpots', {}), getSetting<SplitCfg | null>(db, 'split_draw', null)]);
  const xskt = REGION_CODES.map((r) => regionValue(r));
  const vietlott: { code: string; name: string; returnRatio: number; returnRatioAfterTax: number; note: string }[] = [];
  for (const g of games.filter((x) => x.engine === 'pick')) {
    const dg: DecisionGame = { ...g, schedule: g.drawSchedule, jackpots: jackpots[g.code]?.values ?? {}, jackpotsUpdatedAt: null };
    const pre = evaluateTicketValue(dg, false);
    const post = evaluateTicketValue(dg, true);
    vietlott.push({ code: g.code, name: g.name, returnRatio: pre.returnRatio, returnRatioAfterTax: post.returnRatio, note: pre.jackpotIsMinimum ? 'Jackpot theo mức tối thiểu' : `Jackpot ${Math.round((pre.jackpotUsed ?? 0) / 1e9)} tỷ` });
  }
  const lotto = games.find((g) => g.code === 'lotto535');
  if (split && lotto && split.game === 'lotto535') {
    // Ước lượng thận trọng giống trang Quyết định hôm nay.
    const T = split.tickets_override ?? (split.reference_winners ? estimateTickets(lotto, split.reference_winners)?.tickets : null) ?? null;
    if (T) {
      const cons = Math.round(T * (1 + split.sales_growth));
      const pre = splitDrawEV(lotto, split.jackpot, cons, LOTTO535_SPLIT_SHARES, false);
      const post = splitDrawEV(lotto, split.jackpot, cons, LOTTO535_SPLIT_SHARES, true);
      vietlott.push({ code: 'lotto535_split', name: `Lotto 5/35, kỳ Chia giải ${split.date}`, returnRatio: pre.returnRatio, returnRatioAfterTax: post.returnRatio, note: `≈ ${(cons / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} triệu lần dự thưởng (thận trọng)` });
    } else vietlott.push({ code: 'lotto535_split', name: `Lotto 5/35, kỳ Chia giải ${split.date}`, returnRatio: NaN, returnRatioAfterTax: NaN, note: 'Xem đánh giá chi tiết ở trang Quyết định hôm nay' });
  }
  return c.json({
    data: {
      xskt,
      vietlott,
      insights: [
        'Vé XSKT trả lại cố định khoảng 50% tiền vé (trước thuế), cao hơn Lotto 5/35 kỳ thường (31 đến 45%) nhưng không bao giờ có kỳ vọng dương.',
        'Thời điểm duy nhất có thể có lợi thế là kỳ Chia giải Độc đắc của Lotto 5/35 (xem trang Quyết định hôm nay).',
        'Mọi vé XSKT có cùng xác suất: chọn số “đẹp”, đài “dễ trúng” hay mua theo dự báo không làm thay đổi kỳ vọng.',
      ],
    },
  });
});

xsktRoutes.post('/admin/xskt/sync', requireRole('admin'), async (c) => {
  const b = await parseJson(c, z.object({ regions: z.array(RegionEnum).optional() }));
  const results = await syncXskt(actorFromContext(c), fetch, b.regions);
  return c.json({ data: results });
});
