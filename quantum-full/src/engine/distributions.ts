/**
 * Hàm phân phối thống kê thuần TypeScript: Gamma, Beta không đầy đủ chuẩn hoá, χ², chuẩn tắc,
 * khoảng tin cậy Wilson, hiệu chỉnh đa kiểm định (Bonferroni, Benjamini–Hochberg).
 */

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Hàm Gamma không đầy đủ chuẩn hoá dưới P(a, x). */
export function regularizedGammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  return 1 - regularizedGammaQcf(a, x);
}

function regularizedGammaQcf(a: number, x: number): number {
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** P(X ≥ x) với X ~ χ²(df). */
export function chiSquareSurvival(x: number, df: number): number {
  if (x <= 0) return 1;
  if (x < df / 2 + 1) return 1 - regularizedGammaP(df / 2, x / 2);
  return regularizedGammaQcf(df / 2, x / 2);
}

/** Hàm phân phối tích luỹ chuẩn tắc Φ(z) — Abramowitz–Stegun 7.1.26 qua erf với độ chính xác ~1e-7; dùng erfc chuỗi cho đuôi. */
export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

export function erfc(x: number): number {
  // Numerical Recipes erfcc (sai số tương đối < 1.2e-7).
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z - 1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** p-value hai phía của thống kê z. */
export function twoSidedP(z: number): number {
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
}

/** Nghịch đảo Φ — thuật toán Acklam (sai số ~1.15e-9). */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError('p phải trong (0,1)');
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

/** Hàm Beta không đầy đủ chuẩn hoá I_x(a, b) = CDF của Beta(a, b) tại x. */
export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbt = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const bt = Math.exp(lbt);
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Phân vị của Beta(a, b) bằng chia đôi (ổn định, đủ chính xác cho khoảng tin cậy). */
export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (regularizedBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  return (lo + hi) / 2;
}

/** Khoảng tin cậy Wilson cho tỷ lệ nhị thức. */
export function wilsonInterval(successes: number, trials: number, confidence = 0.95): { low: number; high: number; center: number } {
  if (trials <= 0) return { low: 0, high: 1, center: 0 };
  const z = normalQuantile(1 - (1 - confidence) / 2);
  const p = successes / trials;
  const denom = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half), center };
}

/** Khoảng tin cậy chuẩn cho trung bình mẫu. */
export function meanInterval(values: number[], confidence = 0.95): { mean: number; low: number; high: number; sd: number; n: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, low: 0, high: 0, sd: 0, n: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const z = normalQuantile(1 - (1 - confidence) / 2);
  const half = n > 0 ? (z * sd) / Math.sqrt(n) : 0;
  return { mean, low: mean - half, high: mean + half, sd, n };
}

export function bonferroni(pValues: number[]): number[] {
  return pValues.map((p) => Math.min(1, p * pValues.length));
}

/** Benjamini–Hochberg: trả về q-value (FDR-adjusted p) theo đúng thứ tự đầu vào. */
export function benjaminiHochberg(pValues: number[]): number[] {
  const m = pValues.length;
  const idx = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const q = new Array<number>(m);
  let prev = 1;
  for (let r = m - 1; r >= 0; r--) {
    const v = Math.min(prev, (idx[r].p * m) / (r + 1));
    q[idx[r].i] = Math.min(1, v);
    prev = v;
  }
  return q;
}

/** P(X ≥ k) với X ~ Poisson(λ). */
export function poissonUpperTail(k: number, lambda: number): number {
  if (k <= 0) return 1;
  // P(X ≥ k) = P(k, λ) theo hàm Gamma không đầy đủ chuẩn hoá dưới.
  return regularizedGammaP(k, lambda);
}
