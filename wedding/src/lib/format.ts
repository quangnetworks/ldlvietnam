import type { WeddingEvent } from '../data/types';

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function parts(iso: string) {
  const [y, m, d] = iso.split('-');
  return { day: d, month: m, year: y, monthEn: MONTHS_EN[Number(m) - 1] };
}

/** 14.11.2026 */
export function dotDate(iso: string) {
  const p = parts(iso);
  return `${p.day}.${p.month}.${p.year}`;
}

/** 14/11/2026 */
export function slashDate(iso: string) {
  const p = parts(iso);
  return `${p.day}/${p.month}/${p.year}`;
}

/** "14 giờ 00" */
export function viTime(t: string) {
  const [h, m] = t.split(':');
  return `${h} giờ ${m}`;
}

export function daysUntil(iso: string, from = new Date()) {
  const target = new Date(`${iso}T00:00:00+07:00`).getTime();
  const start = new Date(from.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }) + 'T00:00:00+07:00').getTime();
  return Math.round((target - start) / 86_400_000);
}

export function mapsUrl(e: WeddingEvent) {
  const q = [e.venueKind, e.venueName, ...e.venueAddressLines].join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ');
}
