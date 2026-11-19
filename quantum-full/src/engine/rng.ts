/**
 * Bộ sinh số ngẫu nhiên có seed (tái lập được) — xoshiro128** khởi tạo bằng splitmix32 từ chuỗi seed.
 * Dùng cho mô phỏng/kiểm định. Khi người dùng không nhập seed, hệ thống tạo seed từ crypto.getRandomValues
 * và LƯU LẠI seed đó để có thể tái lập kết quả.
 */

export interface Rng {
  /** Số thực đều trong [0, 1). */
  next(): number;
  /** Số nguyên 32-bit không dấu đều. */
  nextUint32(): number;
  /** Số nguyên đều trong [min, max] (bao gồm hai đầu), không lệch modulo. */
  int(min: number, max: number): number;
}

function hashSeed(seed: string): number {
  // FNV-1a 32-bit, sau đó trộn bằng splitmix.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function splitmix32(a: number): () => number {
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return t >>> 0;
  };
}

export function createRng(seed: string): Rng {
  const sm = splitmix32(hashSeed(seed));
  let s0 = sm(), s1 = sm(), s2 = sm(), s3 = sm();
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;
  const rotl = (x: number, k: number) => (x << k) | (x >>> (32 - k));
  const nextUint32 = (): number => {
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    return result;
  };
  const rng: Rng = {
    nextUint32,
    next: () => nextUint32() / 4294967296,
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new RangeError('Khoảng không hợp lệ');
      const range = max - min + 1;
      if (range > 4294967296) throw new RangeError('Khoảng quá lớn');
      // Rejection sampling để loại bỏ lệch modulo.
      const limit = 4294967296 - (4294967296 % range);
      let x: number;
      do x = nextUint32();
      while (x >= limit);
      return min + (x % range);
    },
  };
  return rng;
}

/** Seed ngẫu nhiên an toàn mật mã (dùng khi người dùng không cung cấp seed). */
export function randomSeed(): string {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return `${buf[0].toString(16).padStart(8, '0')}${buf[1].toString(16).padStart(8, '0')}`;
}

/** Chọn k phần tử phân biệt đều từ [min, max] (Fisher–Yates từng phần), trả về đã sắp xếp tăng dần. */
export function sampleDistinct(rng: Rng, min: number, max: number, k: number): number[] {
  const n = max - min + 1;
  if (k > n || k < 0) throw new RangeError('k không hợp lệ');
  const pool = Array.from({ length: n }, (_, i) => min + i);
  for (let i = 0; i < k; i++) {
    const j = rng.int(i, n - 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, k).sort((a, b) => a - b);
}

/**
 * Chọn k phần tử phân biệt có trọng số (không hoàn lại) — thuật toán Efraimidis–Spirakis (A-Res).
 * weights[i] tương ứng số min+i. Trọng số phải > 0.
 */
export function sampleWeightedDistinct(rng: Rng, min: number, weights: number[], k: number): number[] {
  if (k > weights.length) throw new RangeError('k vượt số phần tử');
  const keyed = weights.map((w, i) => {
    if (!(w > 0) || !Number.isFinite(w)) throw new RangeError('Trọng số phải dương và hữu hạn');
    let u = rng.next();
    if (u === 0) u = Number.MIN_VALUE;
    return { v: min + i, key: Math.log(u) / w };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, k).map((x) => x.v).sort((a, b) => a - b);
}

/** Mẫu Gamma(shape, 1) — Marsaglia & Tsang; dùng cho lấy mẫu Dirichlet/Beta. */
export function sampleGamma(rng: Rng, shape: number): number {
  if (shape <= 0) throw new RangeError('shape phải > 0');
  if (shape < 1) {
    const u = rng.next() || Number.MIN_VALUE;
    return sampleGamma(rng, shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      x = sampleNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng.next();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u || Number.MIN_VALUE) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Chuẩn tắc N(0,1) — Box–Muller. */
export function sampleNormal(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng.next();
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function sampleDirichlet(rng: Rng, alpha: number[]): number[] {
  const g = alpha.map((a) => sampleGamma(rng, a));
  const s = g.reduce((x, y) => x + y, 0);
  return g.map((x) => x / s);
}
