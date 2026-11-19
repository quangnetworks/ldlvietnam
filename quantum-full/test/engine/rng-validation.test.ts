import { describe, expect, it } from 'vitest';
import { createRng, sampleDistinct, sampleWeightedDistinct } from '../../src/engine/rng';
import { chiSquareSurvival } from '../../src/engine/distributions';
import { checkBudget, findDuplicates, findDuplicateTickets, validateDrawResult, validateTicket } from '../../src/engine/validation';
import { generateTickets } from '../../src/engine/strategies';
import { LOTTO535, POWER655 } from '../fixtures';

describe('RNG có seed', () => {
  it('Tái lập được theo seed', () => {
    const a = createRng('abc');
    const b = createRng('abc');
    const c = createRng('abd');
    const xa = Array.from({ length: 5 }, () => a.nextUint32());
    expect(Array.from({ length: 5 }, () => b.nextUint32())).toEqual(xa);
    expect(Array.from({ length: 5 }, () => c.nextUint32())).not.toEqual(xa);
  });
  it('rng.int đồng đều (χ², 350.000 mẫu)', () => {
    const r = createRng('uniformity');
    const counts = new Array(35).fill(0);
    const n = 350000;
    for (let i = 0; i < n; i++) counts[r.int(1, 35) - 1]++;
    const e = n / 35;
    const x2 = counts.reduce((s, c) => s + (c - e) ** 2 / e, 0);
    expect(chiSquareSurvival(x2, 34)).toBeGreaterThan(0.001);
  });
  it('sampleDistinct luôn trong miền, không trùng, đã sắp xếp', () => {
    const r = createRng('distinct');
    for (let i = 0; i < 2000; i++) {
      const s = sampleDistinct(r, 1, 55, 6);
      expect(s.length).toBe(6);
      expect(new Set(s).size).toBe(6);
      expect(s.every((x) => x >= 1 && x <= 55)).toBe(true);
      expect([...s].sort((a, b) => a - b)).toEqual(s);
    }
  });
  it('sampleWeightedDistinct từ chối trọng số âm', () => {
    expect(() => sampleWeightedDistinct(createRng('w'), 1, [1, -1, 1], 1)).toThrow();
  });
});

describe('Kiểm tra hợp lệ', () => {
  it('Miền số & trùng lặp', () => {
    expect(validateTicket(LOTTO535, { main: [1, 2, 3, 4, 5], special: 12 })).toEqual([]);
    expect(validateTicket(LOTTO535, { main: [0, 2, 3, 4, 36], special: 1 }).map((i) => i.code)).toEqual(['main_out_of_range', 'main_out_of_range']);
    expect(validateTicket(LOTTO535, { main: [1, 1, 3, 4, 5], special: 1 }).map((i) => i.code)).toContain('main_duplicate');
    expect(validateTicket(LOTTO535, { main: [1, 2, 3, 4], special: 1 }).map((i) => i.code)).toContain('main_count');
    expect(findDuplicates([3, 1, 3, 2, 1])).toEqual([1, 3]);
  });
  it('Số đặc biệt', () => {
    expect(validateTicket(LOTTO535, { main: [1, 2, 3, 4, 5], special: 13 }).map((i) => i.code)).toEqual(['special_out_of_range']);
    expect(validateTicket(LOTTO535, { main: [1, 2, 3, 4, 5] }).map((i) => i.code)).toEqual(['special_missing']);
    expect(validateTicket(POWER655, { main: [1, 2, 3, 4, 5, 6], special: 7 }).map((i) => i.code)).toEqual(['special_not_allowed']);
    expect(validateDrawResult(POWER655, { main: [1, 2, 3, 4, 5, 6], special: 6 }).map((i) => i.code)).toEqual(['special_duplicates_main']);
    expect(validateDrawResult(POWER655, { main: [1, 2, 3, 4, 5, 6], special: 56 }).map((i) => i.code)).toEqual(['special_out_of_range']);
    expect(validateDrawResult(POWER655, { main: [1, 2, 3, 4, 5, 6], special: 55 })).toEqual([]);
  });
  it('Vé trùng nhau', () => {
    expect(findDuplicateTickets([{ main: [1, 2, 3, 4, 5], special: 1 }, { main: [5, 4, 3, 2, 1], special: 1 }, { main: [1, 2, 3, 4, 5], special: 2 }])).toEqual([1]);
  });
  it('Ngân sách', () => {
    expect(checkBudget(10000, 10, 100000).ok).toBe(true);
    expect(checkBudget(10000, 11, 100000).issues.map((i) => i.code)).toEqual(['over_budget']);
    expect(checkBudget(10000, 10, 200000, 50000).issues.map((i) => i.code)).toEqual(['over_draw_limit']);
    expect(checkBudget(10000, 0, 100000).ok).toBe(false);
    expect(checkBudget(10000, 1, 100000, 50000).maxTickets).toBe(5);
  });
});

describe('Random Uniform generator', () => {
  it('Không tạo số sai miền, không trùng vé, đúng số đặc biệt', () => {
    for (const rules of [LOTTO535, POWER655]) {
      const t = generateTickets('random_uniform', { rules, history: [], rng: createRng('g'), params: {} }, 200);
      expect(findDuplicateTickets(t)).toEqual([]);
      for (const x of t) expect(validateTicket(rules, x)).toEqual([]);
    }
  });
});
