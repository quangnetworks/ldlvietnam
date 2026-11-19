import { describe, expect, it } from 'vitest';
import { combination, combinationBig, factorialBig, permutationBig, rational, rAdd, rToNumber, rOneIn } from '../../src/engine/combinatorics';

describe('Tổ hợp (giá trị kỳ vọng độc lập)', () => {
  it('C(n,k) cơ bản', () => {
    expect(combination(5, 2)).toBe(10);
    expect(combination(10, 0)).toBe(1);
    expect(combination(10, 10)).toBe(1);
    expect(combination(3, 5)).toBe(0);
  });
  it('C(35,5) = 324.632 và C(55,6) = 28.989.675', () => {
    expect(combinationBig(35, 5)).toBe(324632n);
    expect(combinationBig(55, 6)).toBe(28989675n);
    // Đối chiếu bằng công thức giai thừa độc lập: n!/(k!(n-k)!)
    expect(factorialBig(55) / (factorialBig(6) * factorialBig(49))).toBe(28989675n);
    expect(factorialBig(35) / (factorialBig(5) * factorialBig(30))).toBe(324632n);
  });
  it('Tổng số kết quả Lotto 5/35 = C(35,5)×12 = 3.895.584', () => {
    expect(combinationBig(35, 5) * 12n).toBe(3895584n);
  });
  it('Đối xứng C(n,k)=C(n,n−k) và hằng đẳng thức Pascal', () => {
    for (let n = 1; n < 40; n++) for (let k = 1; k < n; k++) {
      expect(combinationBig(n, k)).toBe(combinationBig(n, n - k));
      expect(combinationBig(n, k)).toBe(combinationBig(n - 1, k - 1) + combinationBig(n - 1, k));
    }
  });
  it('Chỉnh hợp P(n,k) = n!/(n−k)!', () => {
    expect(permutationBig(10, 3)).toBe(720n);
    expect(permutationBig(55, 6)).toBe(factorialBig(55) / factorialBig(49));
  });
  it('Số lớn chính xác — C(100,50)', () => {
    expect(combinationBig(100, 50)).toBe(100891344545564193334812497256n);
  });
  it('Từ chối tham số không hợp lệ', () => {
    expect(() => combinationBig(-1, 2)).toThrow();
    expect(() => combinationBig(2.5, 1)).toThrow();
  });
  it('Phân số tối giản & chuyển đổi', () => {
    const r = rational(6n, 28989675n);
    expect(r).toEqual({ num: 2n, den: 9663225n });
    expect(rToNumber(rAdd(rational(1n, 3n), rational(1n, 6n)))).toBeCloseTo(0.5, 15);
    expect(rOneIn(rational(1n, 3895584n))).toBe(3895584);
    expect(rToNumber(rational(1n, 10n ** 40n))).toBeCloseTo(1e-40, 50);
  });
});
