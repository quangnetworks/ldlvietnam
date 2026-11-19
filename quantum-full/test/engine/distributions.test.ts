import { describe, expect, it } from 'vitest';
import { benjaminiHochberg, betaQuantile, chiSquareSurvival, normalCdf, normalQuantile, regularizedBeta, wilsonInterval, poissonUpperTail } from '../../src/engine/distributions';

describe('Hàm phân phối (đối chiếu bảng tra chuẩn)', () => {
  it('χ² giá trị tới hạn 5%', () => {
    expect(chiSquareSurvival(3.841459, 1)).toBeCloseTo(0.05, 5);
    expect(chiSquareSurvival(18.307038, 10)).toBeCloseTo(0.05, 5);
    expect(chiSquareSurvival(48.602367, 34)).toBeCloseTo(0.05, 4);
  });
  it('Chuẩn tắc', () => {
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
  });
  it('Beta: I_0.5(2,3) = 0.6875 (công thức đóng 6x²−8x³+3x⁴)', () => {
    expect(regularizedBeta(0.5, 2, 3)).toBeCloseTo(0.6875, 10);
    expect(betaQuantile(0.5, 2, 2)).toBeCloseTo(0.5, 8);
  });
  it('Wilson 95% cho 50/100', () => {
    const w = wilsonInterval(50, 100);
    expect(w.low).toBeCloseTo(0.4038, 3);
    expect(w.high).toBeCloseTo(0.5962, 3);
  });
  it('Poisson: P(X ≥ 1 | λ=1) = 1 − e^{-1}', () => {
    expect(poissonUpperTail(1, 1)).toBeCloseTo(1 - Math.exp(-1), 10);
  });
  it('Benjamini–Hochberg', () => {
    const q = benjaminiHochberg([0.01, 0.04, 0.03, 0.2]);
    expect(q[0]).toBeCloseTo(0.04, 10);
    expect(q[2]).toBeCloseTo(0.16 / 3, 10);
    expect(q[1]).toBeCloseTo(0.16 / 3, 10);
    expect(q[3]).toBeCloseTo(0.2, 10);
  });
});
