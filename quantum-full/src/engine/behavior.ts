/**
 * Q7 — HUMAN BEHAVIOR ENGINE
 * Ước lượng MỨC ĐỘ PHỔ BIẾN dự kiến của một bộ số dựa trên các thiên lệch hành vi đã được ghi nhận
 * trong nghiên cứu xổ số (chọn ngày sinh, dãy liên tiếp, hoa văn trên phiếu, số may mắn...).
 *
 * ĐÂY CHỈ LÀ MÔ HÌNH HEURISTIC. Không có dữ liệu bán vé ⇒ không biết số lượng vé thực tế người khác đã mua.
 * Mức phổ biến KHÔNG ảnh hưởng xác suất trúng; nó chỉ liên quan tới khả năng phải CHIA GIẢI nếu trúng.
 */
import type { GameRules } from '../shared/game';
import { createRng, sampleDistinct } from './rng';

export const BEHAVIOR_DISCLAIMER =
  'Điểm phổ biến là ước lượng heuristic dựa trên thiên lệch hành vi phổ biến, không dựa trên dữ liệu bán vé. Không ảnh hưởng xác suất trúng thưởng.';

export const LUCKY_NUMBERS = new Set([6, 7, 8, 9, 16, 18, 26, 28, 36, 38, 39, 68, 79, 86]);
/** Lưới phiếu giả định 7 cột để đánh giá hoa văn thị giác. */
export const GRID_COLUMNS = 7;

export interface BehaviorFeature {
  key: string;
  label: string;
  value: number;
  weight: number;
  contribution: number;
}

export interface BehaviorScore {
  score: number;
  /** Thứ hạng phần trăm so với bộ số ngẫu nhiên (0 = ít phổ biến nhất, 100 = phổ biến nhất). */
  percentile: number;
  level: 'thấp' | 'trung bình' | 'cao' | 'rất cao';
  features: BehaviorFeature[];
  disclaimer: string;
}

function longestRun(sorted: number[]): number {
  let best = 1;
  let cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    cur = sorted[i] - sorted[i - 1] === 1 ? cur + 1 : 1;
    best = Math.max(best, cur);
  }
  return best;
}

export function behaviorFeatures(rules: GameRules, main: number[]): BehaviorFeature[] {
  const s = [...main].sort((a, b) => a - b);
  const K = s.length;
  const diffs = s.slice(1).map((x, i) => x - s[i]);
  const birth = s.filter((x) => x <= 31).length / K;
  const month = s.filter((x) => x <= 12).length / K;
  const run = (longestRun(s) - 1) / Math.max(1, K - 1);
  const ap = diffs.length && diffs.every((d) => d === diffs[0]) ? 1 : (diffs.length - new Set(diffs).size) / Math.max(1, diffs.length);
  const lastDigits = new Map<number, number>();
  for (const x of s) lastDigits.set(x % 10, (lastDigits.get(x % 10) ?? 0) + 1);
  const sameDigit = (Math.max(...lastDigits.values()) - 1) / Math.max(1, K - 1);
  const mult = Math.max(s.filter((x) => x % 5 === 0).length, s.filter((x) => x % 7 === 0).length) / K;
  const lucky = s.filter((x) => LUCKY_NUMBERS.has(x)).length / K;
  const rows = new Map<number, number>();
  const cols = new Map<number, number>();
  for (const x of s) {
    const idx = x - rules.mainMin;
    rows.set(Math.floor(idx / GRID_COLUMNS), (rows.get(Math.floor(idx / GRID_COLUMNS)) ?? 0) + 1);
    cols.set(idx % GRID_COLUMNS, (cols.get(idx % GRID_COLUMNS) ?? 0) + 1);
  }
  const line = (Math.max(...rows.values(), ...cols.values()) - 1) / Math.max(1, K - 1);
  const center = (rules.mainMin + rules.mainMax) / 2;
  const mirrored = s.filter((x) => s.includes(Math.round(2 * center - x)) && x !== center).length / K;
  const defs: [string, string, number, number][] = [
    ['birthdate', 'Số ≤ 31 (ngày sinh)', birth, 18],
    ['month', 'Số ≤ 12 (tháng sinh)', month, 10],
    ['consecutive', 'Dãy số liên tiếp', run, 22],
    ['arithmetic', 'Cấp số cộng / khoảng cách đều', ap, 14],
    ['same_digit', 'Cùng chữ số tận cùng', sameDigit, 8],
    ['multiples', 'Bội số của 5 hoặc 7', mult, 6],
    ['lucky', 'Số "may mắn" phổ biến', lucky, 8],
    ['grid_line', 'Thẳng hàng trên phiếu (lưới 7 cột)', line, 8],
    ['symmetry', 'Đối xứng quanh tâm dải số', mirrored, 6],
  ];
  return defs.map(([key, label, value, weight]) => ({ key, label, value, weight, contribution: value * weight }));
}

export function rawBehaviorScore(rules: GameRules, main: number[]): number {
  const f = behaviorFeatures(rules, main);
  const total = f.reduce((s, x) => s + x.weight, 0);
  return (100 * f.reduce((s, x) => s + x.contribution, 0)) / total;
}

const baselineCache = new Map<string, number[]>();

/** Phân phối điểm của 2.000 bộ số ngẫu nhiên đồng đều (seed cố định) để quy đổi percentile. */
export function baselineScores(rules: GameRules): number[] {
  const key = `${rules.mainMin}-${rules.mainMax}-${rules.mainPicks}`;
  const cached = baselineCache.get(key);
  if (cached) return cached;
  const rng = createRng('behavior-baseline-v1');
  const arr: number[] = [];
  for (let i = 0; i < 2000; i++) arr.push(rawBehaviorScore(rules, sampleDistinct(rng, rules.mainMin, rules.mainMax, rules.mainPicks)));
  arr.sort((a, b) => a - b);
  baselineCache.set(key, arr);
  return arr;
}

export function behaviorScore(rules: GameRules, main: number[]): BehaviorScore {
  const score = rawBehaviorScore(rules, main);
  const base = baselineScores(rules);
  let lo = 0;
  let hi = base.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (base[mid] < score) lo = mid + 1;
    else hi = mid;
  }
  const percentile = (100 * lo) / base.length;
  const level = percentile >= 95 ? 'rất cao' : percentile >= 75 ? 'cao' : percentile >= 30 ? 'trung bình' : 'thấp';
  return { score, percentile, level, features: behaviorFeatures(rules, main), disclaimer: BEHAVIOR_DISCLAIMER };
}
