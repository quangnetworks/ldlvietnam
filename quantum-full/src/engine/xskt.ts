/**
 * XSKT ENGINE — Xổ số kiến thiết 3 miền (vé truyền thống in sẵn số).
 *
 * - Cơ cấu giải khai báo bằng DỮ LIỆU (REGIONS) — đổi thể lệ không cần sửa thuật toán.
 * - Chấm vé, xác suất & kỳ vọng CHÍNH XÁC (mỗi số quay có các chữ số độc lập, đồng đều ⇒ P(trùng d số cuối) = 10^-d;
 *   các số quay độc lập với nhau ⇒ P(không trúng gì) là tích).
 * - Kiểm định giả thuyết "kết quả ngẫu nhiên đồng đều, độc lập" theo miền và theo từng đài, hiệu chỉnh Benjamini–Hochberg.
 * - Mô hình dự báo chấm WALK-FORWARD (mỗi kỳ chỉ dùng dữ liệu trước đó của chính đài đó) bằng log-loss trên từng chữ số,
 *   luôn so với baseline đồng đều (ln 10 nats/chữ số).
 * Không có chức năng lô/đề.
 */
import { benjaminiHochberg, chiSquareSurvival, normalCdf, poissonUpperTail, twoSidedP } from './distributions';

export type Region = 'mb' | 'mn' | 'mt';
export const REGION_CODES: Region[] = ['mb', 'mt', 'mn'];

export interface XsktTier {
  code: string;
  name: string;
  /** Số lượng số được quay cho giải này mỗi kỳ. */
  count: number;
  /** Số chữ số của mỗi số quay. */
  digits: number;
  /** Giá trị giải cho vé 10.000đ. */
  amount: number;
}

export interface RegionConfig {
  region: Region;
  name: string;
  ticketPrice: number;
  /** Số chữ số trên vé (Bắc: 5 + ký hiệu; Nam/Trung: 6). */
  ticketDigits: number;
  /** Thứ tự giải đúng như thứ tự số trong numbers_json. */
  tiers: XsktTier[];
  special: {
    /** Miền Bắc: xác suất ký hiệu của vé nằm trong các ký hiệu trúng ĐB (6/15 ngày thường). */
    seriesProbability: number | null;
    runnerUp: { name: string; amount: number; rule: 'first_digit_differs' | 'series_miss' };
    consolation: { name: string; amount: number; rule: 'first_same_one_miss' | 'last2' };
  };
  /** Số vé mỗi loại (để hiển thị số giải / loại vé). */
  ticketsPerSeries: number;
  note: string;
}

const SOUTH_TIERS: XsktTier[] = [
  { code: 'special', name: 'Đặc biệt', count: 1, digits: 6, amount: 2_000_000_000 },
  { code: 'first', name: 'Nhất', count: 1, digits: 5, amount: 30_000_000 },
  { code: 'second', name: 'Nhì', count: 1, digits: 5, amount: 15_000_000 },
  { code: 'third', name: 'Ba', count: 2, digits: 5, amount: 10_000_000 },
  { code: 'fourth', name: 'Tư', count: 7, digits: 5, amount: 3_000_000 },
  { code: 'fifth', name: 'Năm', count: 1, digits: 4, amount: 1_000_000 },
  { code: 'sixth', name: 'Sáu', count: 3, digits: 4, amount: 400_000 },
  { code: 'seventh', name: 'Bảy', count: 1, digits: 3, amount: 200_000 },
  { code: 'eighth', name: 'Tám', count: 1, digits: 2, amount: 100_000 },
];

const SOUTH_SPECIAL: RegionConfig['special'] = {
  seriesProbability: null,
  runnerUp: { name: 'Phụ đặc biệt', amount: 50_000_000, rule: 'first_digit_differs' },
  consolation: { name: 'Khuyến khích', amount: 6_000_000, rule: 'first_same_one_miss' },
};

export const REGIONS: Record<Region, RegionConfig> = {
  mb: {
    region: 'mb',
    name: 'Miền Bắc',
    ticketPrice: 10_000,
    ticketDigits: 5,
    tiers: [
      { code: 'special', name: 'Đặc biệt', count: 1, digits: 5, amount: 500_000_000 },
      { code: 'first', name: 'Nhất', count: 1, digits: 5, amount: 10_000_000 },
      { code: 'second', name: 'Nhì', count: 2, digits: 5, amount: 5_000_000 },
      { code: 'third', name: 'Ba', count: 6, digits: 5, amount: 1_000_000 },
      { code: 'fourth', name: 'Tư', count: 4, digits: 4, amount: 400_000 },
      { code: 'fifth', name: 'Năm', count: 6, digits: 4, amount: 200_000 },
      { code: 'sixth', name: 'Sáu', count: 3, digits: 3, amount: 100_000 },
      { code: 'seventh', name: 'Bảy', count: 4, digits: 2, amount: 40_000 },
    ],
    special: {
      seriesProbability: 6 / 15,
      runnerUp: { name: 'Phụ đặc biệt', amount: 25_000_000, rule: 'series_miss' },
      consolation: { name: 'Khuyến khích', amount: 40_000, rule: 'last2' },
    },
    ticketsPerSeries: 100_000,
    note: 'Vé 5 chữ số + ký hiệu; 15 loại vé/ngày, quay 6 ký hiệu đặc biệt (mùng 1 âm lịch: 20 loại, 8 ký hiệu). Kỳ vọng tính theo xác suất ký hiệu 6/15.',
  },
  mn: { region: 'mn', name: 'Miền Nam', ticketPrice: 10_000, ticketDigits: 6, tiers: SOUTH_TIERS, special: SOUTH_SPECIAL, ticketsPerSeries: 1_000_000, note: 'Vé 6 chữ số; mỗi đài một loại vé 1.000.000 số.' },
  mt: { region: 'mt', name: 'Miền Trung', ticketPrice: 10_000, ticketDigits: 6, tiers: SOUTH_TIERS, special: SOUTH_SPECIAL, ticketsPerSeries: 1_000_000, note: 'Vé 6 chữ số; mỗi đài một loại vé 1.000.000 số.' },
};

export function numbersPerDraw(region: Region): number {
  return REGIONS[region].tiers.reduce((s, t) => s + t.count, 0);
}

/** Độ dài chuẩn của từng vị trí số trong numbers_json. */
export function slotDigits(region: Region): number[] {
  return REGIONS[region].tiers.flatMap((t) => Array.from({ length: t.count }, () => t.digits));
}

export function slotTiers(region: Region): XsktTier[] {
  return REGIONS[region].tiers.flatMap((t) => Array.from({ length: t.count }, () => t));
}

export interface XsktDraw {
  station: string;
  date: string;
  numbers: string[];
}

/** Kỳ quay đúng định dạng hiện hành (đủ số lượng, đúng độ dài từng giải). */
export function isCurrentFormat(region: Region, numbers: string[]): boolean {
  const d = slotDigits(region);
  return numbers.length === d.length && numbers.every((n, i) => n.length === d[i] && /^\d+$/.test(n));
}

export const TAX_THRESHOLD = 10_000_000;
export const TAX_RATE = 0.1;
export const taxed = (a: number, apply: boolean) => (!apply || a <= TAX_THRESHOLD ? a : a - TAX_RATE * (a - TAX_THRESHOLD));

export interface PrizeLine {
  code: string;
  name: string;
  amount: number;
  matched: string;
}

/**
 * Chấm một vé với một kỳ quay. Vé trúng nhiều giải được cộng dồn.
 * Miền Bắc: ký hiệu vé không biết trước ⇒ khi trùng 5 số ĐB trả về KỲ VỌNG theo xác suất ký hiệu.
 */
export function ticketPayout(region: Region, ticket: string, numbers: string[], applyTax = false): { total: number; lines: PrizeLine[] } {
  const cfg = REGIONS[region];
  if (ticket.length !== cfg.ticketDigits || !/^\d+$/.test(ticket)) throw new RangeError(`Vé ${cfg.name} phải có ${cfg.ticketDigits} chữ số`);
  const tiers = slotTiers(region);
  const lines: PrizeLine[] = [];
  numbers.forEach((n, i) => {
    const t = tiers[i];
    if (!t || n.length !== t.digits) return;
    if (t.code === 'special') {
      const sp = cfg.special;
      if (ticket === n) {
        if (sp.seriesProbability != null) {
          const v = sp.seriesProbability * taxed(t.amount, applyTax) + (1 - sp.seriesProbability) * taxed(sp.runnerUp.amount, applyTax);
          lines.push({ code: 'special', name: `${t.name} (kỳ vọng theo ký hiệu)`, amount: v, matched: n });
        } else lines.push({ code: 'special', name: t.name, amount: taxed(t.amount, applyTax), matched: n });
      } else if (sp.runnerUp.rule === 'first_digit_differs' && ticket.slice(1) === n.slice(1)) {
        lines.push({ code: 'runner_up', name: sp.runnerUp.name, amount: taxed(sp.runnerUp.amount, applyTax), matched: n });
      } else if (sp.consolation.rule === 'first_same_one_miss' && ticket[0] === n[0]) {
        let miss = 0;
        for (let k = 1; k < n.length; k++) if (ticket[k] !== n[k]) miss++;
        if (miss === 1) lines.push({ code: 'consolation', name: sp.consolation.name, amount: taxed(sp.consolation.amount, applyTax), matched: n });
      }
      if (sp.consolation.rule === 'last2' && ticket.slice(-2) === n.slice(-2)) lines.push({ code: 'consolation', name: sp.consolation.name, amount: taxed(sp.consolation.amount, applyTax), matched: n.slice(-2) });
      return;
    }
    if (ticket.endsWith(n)) lines.push({ code: t.code, name: t.name, amount: taxed(t.amount, applyTax), matched: n });
  });
  return { total: lines.reduce((s, l) => s + l.amount, 0), lines };
}

export interface TierValue {
  code: string;
  name: string;
  amount: number;
  /** Xác suất một vé trúng giải này (ít nhất một lần). */
  probability: number;
  /** Số giải trên một loại vé. */
  perSeries: number;
  expected: number;
}

export interface RegionValue {
  region: Region;
  name: string;
  ticketPrice: number;
  expectedPrize: number;
  expectedPrizeAfterTax: number;
  returnRatio: number;
  returnRatioAfterTax: number;
  pAnyPrize: number;
  tiers: TierValue[];
  note: string;
}

/** Xác suất & kỳ vọng CHÍNH XÁC của một vé XSKT. */
export function regionValue(region: Region): RegionValue {
  const cfg = REGIONS[region];
  const L = cfg.ticketDigits;
  const rows: TierValue[] = [];
  let pNoOther = 1;
  let pSpecialAny = 0;
  for (const t of cfg.tiers) {
    if (t.code === 'special') continue;
    const p1 = 10 ** -t.digits;
    rows.push({ code: t.code, name: t.name, amount: t.amount, probability: 1 - (1 - p1) ** t.count, perSeries: t.count * cfg.ticketsPerSeries * p1, expected: t.count * p1 * t.amount });
    pNoOther *= (1 - p1) ** t.count;
  }
  const sp = cfg.special;
  const spTier = cfg.tiers.find((t) => t.code === 'special')!;
  const pExact = 10 ** -L;
  const head: TierValue[] = [];
  let evSpecial = 0;
  let evSpecialTax = 0;
  if (sp.seriesProbability != null) {
    const s = sp.seriesProbability;
    head.push({ code: 'special', name: spTier.name, amount: spTier.amount, probability: pExact * s, perSeries: cfg.ticketsPerSeries * pExact * s, expected: pExact * s * spTier.amount });
    head.push({ code: 'runner_up', name: sp.runnerUp.name, amount: sp.runnerUp.amount, probability: pExact * (1 - s), perSeries: cfg.ticketsPerSeries * pExact * (1 - s), expected: pExact * (1 - s) * sp.runnerUp.amount });
    const p2 = 0.01;
    head.push({ code: 'consolation', name: sp.consolation.name, amount: sp.consolation.amount, probability: p2, perSeries: cfg.ticketsPerSeries * p2, expected: p2 * sp.consolation.amount });
    pSpecialAny = p2; // trùng 5 số ⊂ trùng 2 số cuối
    evSpecial = head.reduce((x, r) => x + r.expected, 0);
    evSpecialTax = pExact * (s * taxed(spTier.amount, true) + (1 - s) * taxed(sp.runnerUp.amount, true)) + p2 * taxed(sp.consolation.amount, true);
  } else {
    const pRunner = pExact * 9;
    const pCons = 0.1 * (L - 1) * 0.9 * 10 ** -(L - 2);
    head.push({ code: 'special', name: spTier.name, amount: spTier.amount, probability: pExact, perSeries: cfg.ticketsPerSeries * pExact, expected: pExact * spTier.amount });
    head.push({ code: 'runner_up', name: sp.runnerUp.name, amount: sp.runnerUp.amount, probability: pRunner, perSeries: cfg.ticketsPerSeries * pRunner, expected: pRunner * sp.runnerUp.amount });
    head.push({ code: 'consolation', name: sp.consolation.name, amount: sp.consolation.amount, probability: pCons, perSeries: cfg.ticketsPerSeries * pCons, expected: pCons * sp.consolation.amount });
    pSpecialAny = pExact + pRunner + pCons;
    evSpecial = head.reduce((x, r) => x + r.expected, 0);
    evSpecialTax = pExact * taxed(spTier.amount, true) + pRunner * taxed(sp.runnerUp.amount, true) + pCons * taxed(sp.consolation.amount, true);
  }
  const evOther = rows.reduce((x, r) => x + r.expected, 0);
  const evOtherTax = cfg.tiers.filter((t) => t.code !== 'special').reduce((x, t) => x + t.count * 10 ** -t.digits * taxed(t.amount, true), 0);
  const ev = evSpecial + evOther;
  const evTax = evSpecialTax + evOtherTax;
  return {
    region,
    name: cfg.name,
    ticketPrice: cfg.ticketPrice,
    expectedPrize: ev,
    expectedPrizeAfterTax: evTax,
    returnRatio: ev / cfg.ticketPrice,
    returnRatioAfterTax: evTax / cfg.ticketPrice,
    pAnyPrize: 1 - pNoOther * (1 - pSpecialAny),
    tiers: [...head, ...rows],
    note: cfg.note,
  };
}

// ───────────────────────────── KIỂM ĐỊNH NGẪU NHIÊN ─────────────────────────────

export interface XsktTest {
  code: string;
  name: string;
  scope: string;
  statistic: number;
  df: number | null;
  pValue: number;
  qValue: number;
  significant: boolean;
  detail: string;
  /** Quy tắc cấu trúc của cách quay (vd không lặp số trong cùng giải) — không phải dấu hiệu bất thường, không xét vào phán quyết. */
  structural?: boolean;
}

export type XsktVerdict = 'insufficient' | 'random' | 'anomaly' | 'exploitable';

const chi = (obs: number[], exp: number) => obs.reduce((s, o) => s + (o - exp) ** 2 / exp, 0);
const f = (x: number, d: number) => x.toFixed(d).replace('.', ',');

function byStation(draws: XsktDraw[]): Map<string, XsktDraw[]> {
  const m = new Map<string, XsktDraw[]>();
  for (const d of draws) {
    const a = m.get(d.station);
    if (a) a.push(d);
    else m.set(d.station, [d]);
  }
  for (const a of m.values()) a.sort((x, y) => x.date.localeCompare(y.date));
  return m;
}

type RawTest = Omit<XsktTest, 'qValue' | 'significant'>;

function digitTests(draws: XsktDraw[], scope: string): RawTest[] {
  const out: RawTest[] = [];
  // 1) Phân bố đều chữ số theo vị trí (đếm từ phải sang).
  for (let r = 1; r <= 6; r++) {
    const c = new Array<number>(10).fill(0);
    for (const d of draws) for (const n of d.numbers) if (n.length >= r) c[n.charCodeAt(n.length - r) - 48]++;
    const n = c.reduce((s, x) => s + x, 0);
    if (n < 200) continue;
    const x2 = chi(c, n / 10);
    const label = ['hàng đơn vị', 'hàng chục', 'hàng trăm', 'hàng nghìn', 'hàng chục nghìn', 'hàng trăm nghìn'][r - 1];
    out.push({ code: `digit_pos_${r}`, name: `Chữ số ${label}`, scope, statistic: x2, df: 9, pValue: chiSquareSurvival(x2, 9), detail: `${n.toLocaleString('vi-VN')} chữ số; kỳ vọng ${Math.round(n / 10).toLocaleString('vi-VN')} mỗi chữ số.` });
  }
  // 2) Phân bố đều 2 số cuối của mọi giải (00–99).
  const c2 = new Array<number>(100).fill(0);
  let n2 = 0;
  for (const d of draws) for (const n of d.numbers) if (n.length >= 2) (c2[Number(n.slice(-2))]++, n2++);
  if (n2 >= 500) {
    const x2 = chi(c2, n2 / 100);
    out.push({ code: 'last2_uniform', name: 'Hai chữ số cuối (00 đến 99)', scope, statistic: x2, df: 99, pValue: chiSquareSurvival(x2, 99), detail: `${n2.toLocaleString('vi-VN')} số; kỳ vọng ${f(n2 / 100, 1)} lần mỗi đuôi.` });
  }
  // 3) Chữ số của giải đặc biệt (mọi vị trí gộp).
  const cs = new Array<number>(10).fill(0);
  for (const d of draws) for (const ch of d.numbers[0] ?? '') cs[ch.charCodeAt(0) - 48]++;
  const ns = cs.reduce((s, x) => s + x, 0);
  if (ns >= 200) {
    const x2 = chi(cs, ns / 10);
    out.push({ code: 'special_digits', name: 'Chữ số giải đặc biệt', scope, statistic: x2, df: 9, pValue: chiSquareSurvival(x2, 9), detail: `${ns.toLocaleString('vi-VN')} chữ số.` });
  }
  return out;
}

function lagTest(groups: Map<string, XsktDraw[]>, scope: string): RawTest | null {
  // Bảng 10×10: chữ số hàng đơn vị của cùng vị trí giải ở hai kỳ liên tiếp của cùng một đài.
  const T = new Array<number>(100).fill(0);
  let n = 0;
  for (const seq of groups.values())
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1].numbers;
      const b = seq[i].numbers;
      const k = Math.min(a.length, b.length);
      for (let s = 0; s < k; s++) {
        if (!a[s] || !b[s]) continue;
        T[(a[s].charCodeAt(a[s].length - 1) - 48) * 10 + (b[s].charCodeAt(b[s].length - 1) - 48)]++;
        n++;
      }
    }
  if (n < 1000) return null;
  const rs = new Array<number>(10).fill(0);
  const cs = new Array<number>(10).fill(0);
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) (rs[i] += T[i * 10 + j]), (cs[j] += T[i * 10 + j]);
  let x2 = 0;
  for (let i = 0; i < 10; i++)
    for (let j = 0; j < 10; j++) {
      const e = (rs[i] * cs[j]) / n;
      if (e > 0) x2 += (T[i * 10 + j] - e) ** 2 / e;
    }
  return { code: 'lag1_units', name: 'Phụ thuộc kỳ trước (cùng vị trí giải)', scope, statistic: x2, df: 81, pValue: chiSquareSurvival(x2, 81), detail: `${n.toLocaleString('vi-VN')} cặp chữ số hàng đơn vị ở hai kỳ liên tiếp.` };
}

/**
 * Trùng lặp TRONG CÙNG MỘT GIẢI: số kỳ có ít nhất 2 số giống hệt nhau trong cùng một giải, so với quay độc lập.
 * Nếu quan sát = 0 trong khi kỳ vọng lớn ⇒ đơn vị phát hành áp dụng quy tắc quay lại khi trùng (cấu trúc, không phải bất thường).
 */
function withinTierTest(region: Region, draws: XsktDraw[], scope: string): RawTest | null {
  const tiers = REGIONS[region].tiers.filter((t) => t.count > 1);
  let expected = 0;
  let observed = 0;
  const parts: string[] = [];
  for (const t of tiers) {
    let pDup = 1;
    for (let i = 0; i < t.count; i++) pDup *= 1 - i / 10 ** t.digits;
    pDup = 1 - pDup;
    let o = 0;
    let n = 0;
    const start = slotDigits(region).length ? REGIONS[region].tiers.slice(0, REGIONS[region].tiers.indexOf(t)).reduce((x, y) => x + y.count, 0) : 0;
    for (const d of draws) {
      if (d.numbers.length !== numbersPerDraw(region)) continue;
      const g = d.numbers.slice(start, start + t.count);
      n++;
      if (new Set(g).size < g.length) o++;
    }
    expected += n * pDup;
    observed += o;
    if (n * pDup >= 1) parts.push(`${t.name}: ${o} kỳ (lý thuyết ${f(n * pDup, 1)})`);
  }
  if (expected < 1) return null;
  const lower = 1 - poissonUpperTail(observed + 1, expected);
  const upper = poissonUpperTail(observed, expected);
  const p = Math.min(1, 2 * Math.min(lower, upper));
  const structural = observed === 0 && expected >= 10;
  return {
    code: 'within_tier_duplicates',
    name: structural ? 'Không lặp số trong cùng một giải (quy tắc quay)' : 'Số trùng nhau trong cùng một giải',
    scope,
    statistic: observed,
    df: null,
    pValue: p,
    detail: `${parts.join('; ')}.${structural ? ' Chưa từng có hai số giống nhau trong cùng một giải ⇒ đơn vị quay số quay lại khi trùng. Từng số vẫn có phân bố đều nên không tạo lợi thế.' : ''}`,
    structural,
  };
}

function duplicateTest(draws: XsktDraw[], scope: string): RawTest | null {
  // Số đuôi 2 chữ số KHÁC NHAU trong một kỳ so với bài toán chiếm chỗ chính xác (m = 100 ô, N số).
  const m = 100;
  let sum = 0;
  let varSum = 0;
  let cnt = 0;
  let obs = 0;
  for (const d of draws) {
    const ends = d.numbers.filter((x) => x.length >= 2).map((x) => x.slice(-2));
    const N = ends.length;
    if (N < 5) continue;
    const q1 = (1 - 1 / m) ** N;
    const q2 = (1 - 2 / m) ** N;
    const eEmpty = m * q1;
    const vEmpty = m * (m - 1) * q2 + m * q1 - m * m * q1 * q1;
    sum += m - eEmpty;
    varSum += vEmpty;
    obs += new Set(ends).size;
    cnt++;
  }
  if (cnt < 100) return null;
  const z = (obs - sum) / Math.sqrt(varSum);
  return { code: 'distinct_endings', name: 'Đuôi trùng nhau trong cùng kỳ', scope, statistic: z, df: null, pValue: twoSidedP(z), detail: `Trung bình ${f(obs / cnt, 2)} đuôi khác nhau/kỳ, lý thuyết ${f(sum / cnt, 2)}.` };
}

export interface StationAudit {
  station: string;
  draws: number;
  firstDate: string;
  lastDate: string;
  tests: XsktTest[];
  flagged: boolean;
}

export interface XsktAudit {
  region: Region;
  draws: number;
  stations: number;
  alpha: number;
  tests: XsktTest[];
  stationAudits: StationAudit[];
  verdict: XsktVerdict;
  headline: string;
  explanation: string[];
}

export const XSKT_MIN_DRAWS = 200;

export function xsktAudit(region: Region, draws: XsktDraw[], alpha = 0.05): XsktAudit {
  const groups = byStation(draws);
  const base = { region, draws: draws.length, stations: groups.size, alpha };
  if (draws.length < XSKT_MIN_DRAWS)
    return { ...base, tests: [], stationAudits: [], verdict: 'insufficient', headline: 'CHƯA ĐỦ DỮ LIỆU ĐỂ KẾT LUẬN', explanation: [`Cần ít nhất ${XSKT_MIN_DRAWS} kỳ; hiện có ${draws.length}. Hãy chạy đồng bộ dữ liệu.`] };
  const raw: RawTest[] = [...digitTests(draws, REGIONS[region].name)];
  const lag = lagTest(groups, REGIONS[region].name);
  if (lag) raw.push(lag);
  const tierDup = withinTierTest(region, draws, REGIONS[region].name);
  if (tierDup) raw.push(tierDup);
  // Mô hình "đuôi trùng trong kỳ" giả định các số độc lập; không áp dụng khi đã phát hiện quy tắc không lặp trong cùng giải.
  if (!tierDup?.structural) {
    const dup = duplicateTest(draws, REGIONS[region].name);
    if (dup) raw.push(dup);
  }
  // Từng đài: đuôi 2 số, chữ số hàng đơn vị, phụ thuộc kỳ trước.
  const stRaw: { station: string; seq: XsktDraw[]; tests: RawTest[] }[] = [];
  for (const [station, seq] of groups) {
    if (seq.length < XSKT_MIN_DRAWS) continue;
    const t = digitTests(seq, station).filter((x) => x.code === 'last2_uniform' || x.code === 'digit_pos_1');
    const l = lagTest(new Map([[station, seq]]), station);
    if (l) t.push(l);
    stRaw.push({ station, seq, tests: t });
  }
  // Quy tắc cấu trúc không đưa vào hiệu chỉnh đa kiểm định / phán quyết.
  const all = [...raw.filter((t) => !t.structural), ...stRaw.flatMap((s) => s.tests)];
  const q = benjaminiHochberg(all.map((t) => t.pValue));
  let qi = 0;
  const wrap = (t: RawTest): XsktTest => {
    if (t.structural) return { ...t, qValue: t.pValue, significant: false };
    const qv = q[qi++];
    return { ...t, qValue: qv, significant: qv < alpha };
  };
  const tests = raw.map(wrap);
  const stationAudits: StationAudit[] = stRaw.map((s) => {
    const ts = s.tests.map(wrap);
    return { station: s.station, draws: s.seq.length, firstDate: s.seq[0].date, lastDate: s.seq[s.seq.length - 1].date, tests: ts, flagged: ts.some((t) => t.significant) };
  });
  const flagged = [...tests.filter((t) => t.significant), ...stationAudits.flatMap((s) => s.tests.filter((t) => t.significant))];
  const minP = Math.min(...all.map((t) => t.pValue));
  const explanation: string[] = [];
  let verdict: XsktVerdict;
  let headline: string;
  if (flagged.length) {
    verdict = 'anomaly';
    headline = 'CÓ ĐỘ LỆCH THỐNG KÊ: CẦN RÀ SOÁT';
    explanation.push(`Lệch sau hiệu chỉnh đa kiểm định: ${flagged.slice(0, 6).map((t) => `${t.scope} · ${t.name} (q = ${f(t.qValue, 3)})`).join('; ')}${flagged.length > 6 ? '…' : ''}.`);
    explanation.push('Độ lệch có thể do lỗi dữ liệu nguồn (nhập sai, đổi định dạng) hoặc thiết bị quay. Đối chiếu kết quả chính thức của công ty XSKT trước khi kết luận. Xem tab Mô hình dự báo để biết độ lệch có khai thác được không.');
  } else {
    verdict = 'random';
    headline = 'KẾT QUẢ KHỚP NGẪU NHIÊN: KHÔNG CÓ QUY LUẬT';
    explanation.push(`${all.length} kiểm định (miền và ${stationAudits.length} đài) đều không có ý nghĩa sau hiệu chỉnh Benjamini–Hochberg (p nhỏ nhất ${f(minP, 4)}).`);
  }
  const rule = tests.find((t) => t.structural);
  if (rule) explanation.push(`Phát hiện quy tắc quay: ${rule.detail}`);
  explanation.push('Mọi số vé có cùng xác suất trúng. Không có “con số đẹp” hay đài “dễ trúng” hơn.');
  return { ...base, tests, stationAudits, verdict, headline, explanation };
}

// ───────────────────────────── MÔ HÌNH DỰ BÁO (WALK-FORWARD) ─────────────────────────────

export type XsktModelCode = 'uniform' | 'hot' | 'cold' | 'bayes' | 'markov' | 'ensemble';

export const XSKT_MODELS: Record<XsktModelCode, { name: string; description: string }> = {
  uniform: { name: 'Đồng đều (baseline)', description: 'Mỗi chữ số 0 đến 9 xác suất 1/10 ở mọi vị trí.' },
  hot: { name: 'Số nóng', description: 'Tần suất chữ số theo vị trí trong W kỳ gần nhất của đài (làm trơn Laplace).' },
  cold: { name: 'Số lạnh', description: 'Ưu tiên chữ số ít xuất hiện trong W kỳ gần nhất (giả thuyết “sắp về”).' },
  bayes: { name: 'Bayes Dirichlet', description: 'Posterior Dirichlet theo toàn bộ lịch sử của đài, prior đồng đều độ mạnh 100.' },
  markov: { name: 'Markov bậc 1', description: 'P(chữ số kỳ này | chữ số cùng vị trí giải kỳ trước), học từ lịch sử của đài.' },
  ensemble: { name: 'Tổ hợp', description: 'Trung bình xác suất của Nóng, Lạnh, Bayes, Markov.' },
};

export interface XsktModelResult {
  code: XsktModelCode;
  name: string;
  description: string;
  /** Số kỳ được chấm. */
  draws: number;
  digits: number;
  /** Log-loss trung bình (nats/chữ số); đồng đều = ln 10 ≈ 2,302585. */
  logLoss: number;
  /** Cải thiện so với đồng đều (nats/chữ số; > 0 là tốt hơn). */
  improvement: number;
  z: number;
  pValue: number;
  qValue: number;
  beatsBaseline: boolean;
  /** Tỷ lệ đoán đúng chữ số hàng đơn vị (top-1); ngẫu nhiên 10%. */
  unitsHitRate: number;
  /** Vé gợi ý (chữ số có xác suất cao nhất mỗi vị trí): tiền thưởng thực tế trung bình (trước thuế). */
  ticketMeanPayout: number;
  /** Tỷ lệ kỳ vé gợi ý trúng ít nhất một giải (lý thuyết = pAnyPrize của miền). */
  ticketWinRate: number;
  ticketDraws: number;
}

export interface XsktModels {
  region: Region;
  window: number;
  warmup: number;
  expectedPayout: number;
  expectedWinRate: number;
  models: XsktModelResult[];
  verdict: 'insufficient' | 'no_edge' | 'edge';
  headline: string;
  explanation: string[];
}

const LN10 = Math.log(10);

export function xsktModels(region: Region, draws: XsktDraw[], opts: { window?: number; warmup?: number; alpha?: number } = {}): XsktModels {
  const W = Math.max(5, opts.window ?? 30);
  const warm = Math.max(W, opts.warmup ?? 30);
  const alpha = opts.alpha ?? 0.05;
  const cfg = REGIONS[region];
  const L = cfg.ticketDigits;
  const codes: XsktModelCode[] = ['uniform', 'hot', 'cold', 'bayes', 'markov', 'ensemble'];
  const acc = codes.map(() => ({ sum: 0, sum2: 0, n: 0, digits: 0, ll: 0, hit: 0, units: 0, pay: 0, payN: 0, wins: 0 }));
  const groups = byStation(draws);
  const rv = regionValue(region);
  const expected = rv.expectedPrize;
  for (const seq of groups.values()) {
    const all = new Array<number>(60).fill(0); // [vị trí r 1..6][chữ số] — Bayes
    const win = new Array<number>(60).fill(0); // cửa sổ trượt
    const trans = new Array<number>(600).fill(0); // [r][prev][next]
    for (let i = 0; i < seq.length; i++) {
      const cur = seq[i].numbers;
      const prev = i > 0 ? seq[i - 1].numbers : null;
      if (i >= warm) {
        // Dự báo phân phối từng vị trí r cho mỗi mô hình (không nhìn trước kỳ i).
        const pHot: number[][] = [];
        const pCold: number[][] = [];
        const pBayes: number[][] = [];
        for (let r = 1; r <= 6; r++) {
          const w = win.slice((r - 1) * 10, r * 10);
          const a = all.slice((r - 1) * 10, r * 10);
          const ws = w.reduce((s, x) => s + x, 0);
          const as = a.reduce((s, x) => s + x, 0);
          pHot.push(w.map((x) => (x + 1) / (ws + 10)));
          // Lạnh = đối xứng của Nóng qua phân bố đều (chữ số ít ra được nâng xác suất đúng bằng mức Nóng hạ xuống).
          const cold = w.map((x) => Math.max(0.01, 0.2 - (x + 1) / (ws + 10)));
          const cs = cold.reduce((s, x) => s + x, 0);
          pCold.push(cold.map((x) => x / cs));
          pBayes.push(a.map((x) => (x + 10) / (as + 100)));
        }
        const markovFor = (slot: number, r: number): number[] => {
          const p = prev?.[slot];
          if (!p || p.length < r) return new Array(10).fill(0.1);
          const d0 = p.charCodeAt(p.length - r) - 48;
          const row = trans.slice((r - 1) * 100 + d0 * 10, (r - 1) * 100 + d0 * 10 + 10);
          const s = row.reduce((x, y) => x + y, 0);
          return row.map((x) => (x + 1) / (s + 10));
        };
        const drawLL = codes.map(() => 0);
        let nd = 0;
        cur.forEach((num, slot) => {
          for (let r = 1; r <= num.length; r++) {
            const d = num.charCodeAt(num.length - r) - 48;
            const mk = markovFor(slot, r);
            const ens = pHot[r - 1].map((_, k) => (pHot[r - 1][k] + pCold[r - 1][k] + pBayes[r - 1][k] + mk[k]) / 4);
            const ps = [0.1, pHot[r - 1][d], pCold[r - 1][d], pBayes[r - 1][d], mk[d], ens[d]];
            ps.forEach((p, m) => (drawLL[m] += -Math.log(p)));
            if (r === 1) {
              const dists = [null, pHot[0], pCold[0], pBayes[0], mk, ens];
              dists.forEach((dist, m) => {
                const top = dist ? dist.indexOf(Math.max(...dist)) : (slot * 7 + i) % 10; // baseline: chữ số "ngẫu nhiên" tất định
                if (top === d) acc[m].hit++;
                acc[m].units++;
              });
            }
            nd++;
          }
        });
        // Vé gợi ý: chữ số có xác suất cao nhất ở mỗi vị trí (Markov dùng trung bình các vị trí giải).
        const ticketOK = cur.length === numbersPerDraw(region) && cur[0].length === L;
        codes.forEach((_, m) => {
          const imp = (nd * LN10 - drawLL[m]) / nd; // cải thiện nats/chữ số trong kỳ
          acc[m].sum += imp;
          acc[m].sum2 += imp * imp;
          acc[m].n++;
          acc[m].ll += drawLL[m];
          acc[m].digits += nd;
          if (ticketOK) {
            let t = '';
            for (let r = L; r >= 1; r--) {
              let dist: number[];
              if (m === 0) dist = new Array(10).fill(0.1);
              else if (m === 1) dist = pHot[r - 1];
              else if (m === 2) dist = pCold[r - 1];
              else if (m === 3) dist = pBayes[r - 1];
              else {
                const avg = new Array(10).fill(0);
                for (let s = 0; s < cur.length; s++) markovFor(s, r).forEach((v, k) => (avg[k] += v));
                dist = m === 4 ? avg : avg.map((v, k) => (v / cur.length + pHot[r - 1][k] + pCold[r - 1][k] + pBayes[r - 1][k]) / 4);
              }
              const top = m === 0 ? (i * 3 + r * 7) % 10 : dist.indexOf(Math.max(...dist));
              t += String(top);
            }
            const won = ticketPayout(region, t, cur).total;
            acc[m].pay += won;
            if (won > 0) acc[m].wins++;
            acc[m].payN++;
          }
        });
      }
      // Cập nhật thống kê SAU khi chấm kỳ i.
      for (const num of cur)
        for (let r = 1; r <= num.length && r <= 6; r++) {
          const d = num.charCodeAt(num.length - r) - 48;
          all[(r - 1) * 10 + d]++;
          win[(r - 1) * 10 + d]++;
        }
      if (i - W >= 0)
        for (const num of seq[i - W].numbers)
          for (let r = 1; r <= num.length && r <= 6; r++) win[(r - 1) * 10 + num.charCodeAt(num.length - r) - 48]--;
      if (prev)
        cur.forEach((num, slot) => {
          const p = prev[slot];
          if (!p) return;
          for (let r = 1; r <= Math.min(num.length, p.length, 6); r++) trans[(r - 1) * 100 + (p.charCodeAt(p.length - r) - 48) * 10 + (num.charCodeAt(num.length - r) - 48)]++;
        });
    }
  }
  const raw = codes.map((code, m) => {
    const a = acc[m];
    const mean = a.n ? a.sum / a.n : 0;
    const sd = a.n > 1 ? Math.sqrt(Math.max(0, a.sum2 / a.n - mean * mean) * (a.n / (a.n - 1))) : 0;
    const z = code === 'uniform' || sd === 0 ? 0 : mean / (sd / Math.sqrt(a.n));
    return {
      code,
      name: XSKT_MODELS[code].name,
      description: XSKT_MODELS[code].description,
      draws: a.n,
      digits: a.digits,
      logLoss: a.digits ? a.ll / a.digits : LN10,
      improvement: mean,
      z,
      pValue: code === 'uniform' ? 1 : 1 - normalCdf(z),
      unitsHitRate: a.units ? a.hit / a.units : 0,
      ticketMeanPayout: a.payN ? a.pay / a.payN : 0,
      ticketWinRate: a.payN ? a.wins / a.payN : 0,
      ticketDraws: a.payN,
    };
  });
  const q = benjaminiHochberg(raw.filter((r) => r.code !== 'uniform').map((r) => r.pValue));
  let k = 0;
  const models: XsktModelResult[] = raw.map((r) => {
    if (r.code === 'uniform') return { ...r, qValue: 1, beatsBaseline: false };
    const qv = q[k++];
    return { ...r, qValue: qv, beatsBaseline: qv < alpha && r.improvement > 0 };
  });
  const scored = models[0].draws;
  if (scored < 100)
    return { region, window: W, warmup: warm, expectedPayout: expected, expectedWinRate: rv.pAnyPrize, models, verdict: 'insufficient', headline: 'CHƯA ĐỦ DỮ LIỆU ĐỂ CHẤM MÔ HÌNH', explanation: [`Mới chấm được ${scored} kỳ; cần ít nhất 100.`] };
  const winners = models.filter((m) => m.beatsBaseline);
  const best = [...models].filter((m) => m.code !== 'uniform').sort((a, b) => b.improvement - a.improvement)[0];
  const explanation = [
    `Đã chấm ${scored.toLocaleString('vi-VN')} kỳ (${models[0].digits.toLocaleString('vi-VN')} chữ số) theo walk-forward: mỗi kỳ chỉ dùng dữ liệu trước đó của chính đài.`,
    `Thước đo: log-loss từng chữ số; chọn ngẫu nhiên = ln 10 ≈ 2,3026. Mô hình tốt nhất: ${best.name} với ${f(best.logLoss, 5)} (cải thiện ${best.improvement >= 0 ? '+' : ''}${f(best.improvement * 1000, 3)}‰ nats/chữ số, q = ${f(best.qValue, 3)}).`,
    `Vé gợi ý của các mô hình trúng ít nhất một giải ở ${models.map((m) => `${m.name} ${f(m.ticketWinRate * 100, 2)}%`).join(' · ')} số kỳ, lý thuyết của MỌI vé là ${f(rv.pAnyPrize * 100, 2)}%. Tiền thưởng trung bình dao động rất mạnh vì giải lớn hiếm; kỳ vọng của mọi vé là ${Math.round(expected).toLocaleString('vi-VN')}đ.`,
  ];
  if (winners.length)
    return { region, window: W, warmup: warm, expectedPayout: expected, expectedWinRate: rv.pAnyPrize, models, verdict: 'edge', headline: 'CÓ MÔ HÌNH VƯỢT NGẪU NHIÊN: CẦN KIỂM CHỨNG TRÊN DỮ LIỆU MỚI', explanation: [...explanation, `Vượt chuẩn: ${winners.map((w) => w.name).join(', ')}. Kiểm tra lỗi dữ liệu nguồn và chấm lại trên các kỳ quay sau ngày hôm nay trước khi tin.`] };
  return { region, window: W, warmup: warm, expectedPayout: expected, expectedWinRate: rv.pAnyPrize, models, verdict: 'no_edge', headline: 'KHÔNG MÔ HÌNH NÀO DỰ BÁO TỐT HƠN CHỌN NGẪU NHIÊN', explanation: [...explanation, 'Vì vậy hệ thống không đưa ra “số dự báo”: mọi vé có cùng giá trị kỳ vọng.'] };
}
