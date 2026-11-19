/** Kiểu dữ liệu dùng chung cho các engine (độc lập với DB và UI). */

export interface DrawRecord {
  id: number;
  drawCode: string;
  /** Thời điểm quay (ISO 8601) — dùng để sắp xếp và cắt dữ liệu chống look-ahead. */
  drawAt: string;
  main: number[];
  special: number | null;
}

export interface Ticket {
  main: number[];
  special: number | null;
}

/** Sắp xếp kỳ quay tăng dần theo thời gian (rồi theo mã kỳ để ổn định). */
export function sortDraws<T extends Pick<DrawRecord, 'drawAt' | 'drawCode'>>(draws: T[]): T[] {
  return [...draws].sort((a, b) => (a.drawAt < b.drawAt ? -1 : a.drawAt > b.drawAt ? 1 : a.drawCode.localeCompare(b.drawCode, 'en', { numeric: true })));
}
