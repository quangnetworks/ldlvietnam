/**
 * Q1 — Tổ hợp & số học chính xác.
 * Dùng BigInt để tính tổ hợp chính xác tuyệt đối; xác suất biểu diễn dạng phân số tối giản (Rational)
 * và chỉ chuyển sang số thực khi hiển thị.
 */

export function combinationBig(n: number, k: number): bigint {
  if (!Number.isInteger(n) || !Number.isInteger(k)) throw new RangeError('n, k phải là số nguyên');
  if (n < 0 || k < 0) throw new RangeError('n, k phải không âm');
  if (k > n) return 0n;
  const kk = Math.min(k, n - k);
  let result = 1n;
  for (let i = 1; i <= kk; i++) {
    // result * (n - kk + i) / i luôn chia hết tại mỗi bước
    result = (result * BigInt(n - kk + i)) / BigInt(i);
  }
  return result;
}

export function combination(n: number, k: number): number {
  const v = combinationBig(n, k);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Kết quả vượt Number.MAX_SAFE_INTEGER, hãy dùng combinationBig');
  return Number(v);
}

export function permutationBig(n: number, k: number): bigint {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0) throw new RangeError('Tham số không hợp lệ');
  if (k > n) return 0n;
  let r = 1n;
  for (let i = 0; i < k; i++) r *= BigInt(n - i);
  return r;
}

export function factorialBig(n: number): bigint {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('n phải là số nguyên không âm');
  let r = 1n;
  for (let i = 2; i <= n; i++) r *= BigInt(i);
  return r;
}

function gcdBig(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Phân số tối giản num/den (den > 0). */
export interface Rational {
  num: bigint;
  den: bigint;
}

export function rational(num: bigint, den: bigint): Rational {
  if (den === 0n) throw new RangeError('Mẫu số bằng 0');
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = gcdBig(num, den) || 1n;
  return { num: num / g, den: den / g };
}

export const R0: Rational = { num: 0n, den: 1n };
export const R1: Rational = { num: 1n, den: 1n };

export function rAdd(a: Rational, b: Rational): Rational {
  return rational(a.num * b.den + b.num * a.den, a.den * b.den);
}
export function rSub(a: Rational, b: Rational): Rational {
  return rational(a.num * b.den - b.num * a.den, a.den * b.den);
}
export function rMul(a: Rational, b: Rational): Rational {
  return rational(a.num * b.num, a.den * b.den);
}
export function rEq(a: Rational, b: Rational): boolean {
  return a.num * b.den === b.num * a.den;
}

/** Chuyển phân số sang số thực với độ chính xác cao (chia BigInt có scale trước). */
export function rToNumber(r: Rational): number {
  if (r.num === 0n) return 0;
  const neg = r.num < 0n;
  const n = neg ? -r.num : r.num;
  // Scale để giữ ~17 chữ số có nghĩa ngay cả khi tử/mẫu rất lớn.
  const digits = (x: bigint) => x.toString().length;
  const shift = Math.max(0, digits(r.den) - digits(n) + 20);
  const scaled = (n * 10n ** BigInt(shift)) / r.den;
  const out = Number(`${scaled.toString()}e-${shift}`);
  return neg ? -out : out;
}

/** "1 trên X" — X = den/num (làm tròn) để hiển thị odds dễ hiểu. */
export function rOneIn(r: Rational): number {
  if (r.num === 0n) return Infinity;
  return rToNumber(rational(r.den, r.num));
}

export function rToString(r: Rational): string {
  return `${r.num.toString()}/${r.den.toString()}`;
}
