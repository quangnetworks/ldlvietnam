import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { api, VIEWER } from './helpers';
import { XSKT_SOURCES, normalizeRows, parseCsv, syncXskt, takeBatch } from '../../src/worker/services/xsktSync';
import { synthXskt } from '../xsktFixtures';

const actor = { db: env.DB, actorId: 'system:test', actorRole: 'system', requestId: null, ip: null };

/** Tệp CSV TỔNG HỢP cùng định dạng nguồn mở (chỉ dùng trong test). */
function southCsv(region: 'mn' | 'mt', stations: string[], days: number, seed: string): string {
  const draws = synthXskt(region, stations, days, seed);
  const lines = ['date,station,special,first,second,third,fourth,fifth,sixth,seventh,eighth'];
  for (const d of draws) {
    const n = d.numbers;
    const q = (a: string[]) => (a.length > 1 ? `"${a.join(', ')}"` : a[0]);
    lines.push([d.date, d.station, n[0], n[1], n[2], q(n.slice(3, 5)), q(n.slice(5, 12)), n[12], q(n.slice(13, 16)), n[16], n[17]].join(','));
  }
  return lines.join('\n') + '\n';
}

function mbCsv(days: number, seed: string): string {
  const draws = synthXskt('mb', ['Miền Bắc'], days, seed, { noTierRepeat: true });
  const head = 'date,special,prize1,prize2_1,prize2_2,prize3_1,prize3_2,prize3_3,prize3_4,prize3_5,prize3_6,prize4_1,prize4_2,prize4_3,prize4_4,prize5_1,prize5_2,prize5_3,prize5_4,prize5_5,prize5_6,prize6_1,prize6_2,prize6_3,prize7_1,prize7_2,prize7_3,prize7_4';
  // Nguồn thật làm mất số 0 ở đầu ⇒ mô phỏng bằng Number().
  return [head, ...draws.map((d) => [d.date, ...d.numbers.map((x) => String(Number(x)))].join(','))].join('\n') + '\n';
}

function rangeFetcher(files: Record<string, string>) {
  const calls: string[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    const body = new TextEncoder().encode(files[url] ?? '');
    if (!(url in files)) return new Response('not found', { status: 404 });
    const range = new Headers(init?.headers).get('range');
    calls.push(range ?? 'full');
    const m = range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null;
    if (!m) return new Response(body, { status: 200 });
    const start = Number(m[1]);
    const end = Math.min(body.length - 1, Number(m[2]));
    return new Response(body.slice(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${body.length}` } });
  };
  return { fetcher, calls };
}

describe('Đồng bộ XSKT', () => {
  it('Parse CSV có ngoặc kép; bổ sung số 0 đầu cho miền Bắc; báo dòng sai', () => {
    const south = XSKT_SOURCES.find((s) => s.region === 'mn')!;
    const rows = parseCsv('date,station,special,first,second,third,fourth,fifth,sixth,seventh,eighth\n2026-11-19,Tây Ninh,092492,80399,93361,"17022, 12493","28295, 12321, 18950, 41216, 43115, 51428, 03139",3000,"2326, 3425, 6802",877,71\n2026-11-19,Lỗi,1,2\n');
    const n = normalizeRows(south, rows);
    expect(n.rows).toHaveLength(1);
    expect(n.rows[0].numbers).toHaveLength(18);
    expect(n.rows[0].numbers[0]).toBe('092492');
    expect(n.invalid).toHaveLength(1);
    const mb = XSKT_SOURCES.find((s) => s.region === 'mb')!;
    const r = normalizeRows(mb, parseCsv('2026-11-19,15178,12262,84025,76943,59684,10776,74697,5357,54340,74336,7658,7133,752,8252,1563,6217,1529,2196,4329,932,668,992,163,65,34,73,14\n'));
    expect(r.rows[0].numbers[7]).toBe('05357');
    expect(r.rows[0].numbers[12]).toBe('0752');
    expect(r.rows[0].numbers[19]).toBe('0932');
  });

  it('Nhập dần theo lô không cắt giữa một ngày', () => {
    const rows = ['A', 'B', 'C'].flatMap((st) => ['2026-01-01', '2026-01-02'].map((date) => ({ station: st, date, numbers: [] })));
    expect(takeBatch(rows, null, 2).map((r) => r.date)).toEqual(['2026-01-01', '2026-01-01', '2026-01-01']);
    expect(takeBatch(rows, '2026-01-02', 100)).toHaveLength(3);
  });

  it('Lần đầu tải toàn bộ, lần sau chỉ tải phần đuôi; chạy lại không tạo trùng', async () => {
    const files = {
      [XSKT_SOURCES[0].url]: mbCsv(260, 'mb-file'),
      [XSKT_SOURCES[1].url]: southCsv('mt', ['Đà Nẵng', 'Khánh Hòa'], 130, 'mt-file'),
      [XSKT_SOURCES[2].url]: southCsv('mn', ['Hồ Chí Minh', 'Long An', 'Bình Phước'], 700, 'mn-file'),
    };
    const { fetcher, calls } = rangeFetcher(files);
    const r1 = await syncXskt(actor, fetcher);
    expect(r1.map((r) => r.error)).toEqual([null, null, null]);
    expect(r1.map((r) => r.mode)).toEqual(['full', 'full', 'full']);
    expect(r1.find((r) => r.region === 'mn')!.inserted).toBe(2100);
    const count = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM xskt_draws').first<{ n: number }>())!.n;
    expect(await count()).toBe(260 + 260 + 2100);
    calls.length = 0;
    const r2 = await syncXskt(actor, fetcher);
    expect(r2.every((r) => r.inserted === 0)).toBe(true);
    expect(r2.find((r) => r.region === 'mn')!.mode).toBe('tail');
    // Tệp nhỏ hơn phần đuôi (Bắc, Trung trong test) tải toàn bộ; tệp lớn (Nam) chỉ tải phần đuôi.
    expect(calls.filter((x) => x === 'full')).toHaveLength(2);
    expect(await count()).toBe(2620);
    // Miền Bắc lưu đủ số 0 ở đầu
    const one = await env.DB.prepare("SELECT numbers_json FROM xskt_draws WHERE region = 'mb' LIMIT 1").first<{ numbers_json: string }>();
    expect((JSON.parse(one!.numbers_json) as string[]).map((x) => x.length)).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 2, 2, 2, 2]);

    // API trên dữ liệu vừa đồng bộ
    const sum = await api('/xskt/summary', { token: VIEWER });
    expect(sum.status).toBe(200);
    const mn = sum.body.data.regions.find((r: { region: string }) => r.region === 'mn');
    expect(mn.draws).toBe(2100);
    expect(mn.stations).toHaveLength(3);
    expect(mn.schedule).toHaveLength(7);

    const draws = await api('/xskt/draws?region=mn&station=Long%20An&page_size=5');
    expect(draws.body.data).toHaveLength(5);
    expect(draws.body.data[0].prizes.map((p: { code: string }) => p.code)).toEqual(['special', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth']);
    expect(draws.body.meta.total).toBe(700);

    const audit = await api('/xskt/audit?region=mn');
    expect(audit.status).toBe(200);
    expect(['random', 'anomaly']).toContain(audit.body.data.verdict);
    expect(audit.body.meta.cached).toBe(false);
    expect((await api('/xskt/audit?region=mn')).body.meta.cached).toBe(true);
    const mbAudit = await api('/xskt/audit?region=mb');
    expect(mbAudit.body.data.tests.find((t: { code: string }) => t.code === 'within_tier_duplicates').structural).toBe(true);

    const models = await api('/xskt/models?region=mn&station=Long%20An&window=20');
    expect(models.status).toBe(200);
    expect(models.body.data.station).toBe('Long An');
    expect(models.body.data.models).toHaveLength(6);
    expect(models.body.data.verdict).toBe('no_edge');
  });
});

describe('API XSKT', () => {
  it('Giá trị vé: 3 miền + Vietlott; kiểm tra tham số và quyền', async () => {
    const v = await api('/xskt/value', { token: VIEWER });
    expect(v.status).toBe(200);
    expect(v.body.data.xskt.map((x: { region: string; expectedPrize: number }) => [x.region, Math.round(x.expectedPrize)])).toEqual([
      ['mb', 4990],
      ['mt', 5000],
      ['mn', 5000],
    ]);
    expect(v.body.data.vietlott.map((x: { code: string }) => x.code)).toEqual(expect.arrayContaining(['lotto535', 'power655']));
    expect((await api('/xskt/audit?region=xx')).status).toBe(400);
    expect((await api('/xskt/draws?region=mn', { token: null })).status).toBe(401);
    expect((await api('/admin/xskt/sync', { body: {}, token: VIEWER })).status).toBe(403);
    const mt = await api('/xskt/audit?region=mt');
    expect(mt.status).toBe(200);
    expect(mt.body.data.stations).toBeGreaterThanOrEqual(0);
  });
});
