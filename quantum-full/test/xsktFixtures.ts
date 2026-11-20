/** Lịch sử XSKT TỔNG HỢP chỉ dùng cho kiểm thử (sinh đồng đều với seed cố định). */
import { createRng, type Rng } from '../src/engine/rng';
import { REGIONS, type Region, type XsktDraw } from '../src/engine/xskt';

export const digitStr = (rng: Rng, len: number, bias?: (pos: number) => number | null) =>
  Array.from({ length: len }, (_, i) => {
    const forced = bias?.(len - i);
    return String(forced ?? rng.int(0, 9));
  }).join('');

/** Lịch sử TỔNG HỢP (chỉ dùng trong test). noTierRepeat: mô phỏng quy tắc không lặp số trong cùng giải. */
export function synthXskt(region: Region, stations: string[], days: number, seed: string, opts: { bias?: (rng: Rng, pos: number) => number | null; noTierRepeat?: boolean } = {}): XsktDraw[] {
  const rng = createRng(seed);
  const digits = REGIONS[region].tiers.flatMap((t) => Array.from({ length: t.count }, () => t.digits));
  const out: XsktDraw[] = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(Date.UTC(2020, 0, 1) + d * 864e5).toISOString().slice(0, 10);
    for (const station of stations) {
      const nums: string[] = [];
      let start = 0;
      for (const t of REGIONS[region].tiers) {
        const seen = new Set<string>();
        for (let k = 0; k < t.count; k++) {
          let n: string;
          do n = digitStr(rng, t.digits, opts.bias ? (pos) => opts.bias!(rng, pos) : undefined);
          while (opts.noTierRepeat && seen.has(n));
          seen.add(n);
          nums.push(n);
        }
        start += t.count;
      }
      if (nums.length !== digits.length) throw new Error('sai số lượng số');
      out.push({ station, date, numbers: nums });
    }
  }
  return out;
}

