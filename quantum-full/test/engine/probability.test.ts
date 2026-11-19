import { describe, expect, it } from 'vitest';
import {
  anyPrizeProbability, atLeastOneAcrossIndependent, expectedValue, hypergeometric, jackpotProbability,
  jackpotProbabilityForDistinctTickets, tierProbabilities, totalOutcomes,
} from '../../src/engine/probability';
import { R1, rational, rEq, rAdd, R0, rToNumber } from '../../src/engine/combinatorics';
import { LOTTO535, POWER655 } from '../fixtures';

const byCode = (rules: typeof LOTTO535) => Object.fromEntries(tierProbabilities(rules).map((t) => [t.tier.code, t.probability]));

describe('Siêu bội', () => {
  it('Tổng xác suất = 1', () => {
    let s = R0;
    for (let k = 0; k <= 6; k++) s = rAdd(s, hypergeometric(55, 6, 6, k));
    expect(rEq(s, R1)).toBe(true);
  });
});

describe('Lotto 5/35 — xác suất từng hạng (đếm thủ công trên 3.895.584 kết quả)', () => {
  const T = 3895584n;
  const p = byCode(LOTTO535);
  it('tổng số kết quả', () => expect(totalOutcomes(LOTTO535)).toBe(T));
  it('Độc đắc = 1/3.895.584', () => {
    expect(rEq(p.jackpot, rational(1n, T))).toBe(true);
    expect(rEq(jackpotProbability(LOTTO535), rational(1n, T))).toBe(true);
  });
  it('Nhất = 11/T; Nhì = 150/T; Ba = 1650/T; Tư = 4350/T; Năm = 47850/T', () => {
    expect(rEq(p.first, rational(11n, T))).toBe(true);
    expect(rEq(p.second, rational(150n, T))).toBe(true); // C(5,4)·C(30,1)·1
    expect(rEq(p.third, rational(1650n, T))).toBe(true); // 150·11
    expect(rEq(p.fourth, rational(4350n, T))).toBe(true); // C(5,3)·C(30,2)
    expect(rEq(p.fifth, rational(47850n, T))).toBe(true);
  });
  it('Khuyến khích (k số + ĐB)', () => {
    expect(rEq(p.consolation_2, rational(40600n, T))).toBe(true); // C(5,2)·C(30,3)
    expect(rEq(p.consolation_1, rational(137025n, T))).toBe(true); // 5·C(30,4)
    expect(rEq(p.consolation_0, rational(142506n, T))).toBe(true); // C(30,5)
  });
  it('Xác suất trúng giải bất kỳ', () => {
    const expected = 1n + 11n + 150n + 1650n + 4350n + 47850n + 40600n + 137025n + 142506n;
    expect(rEq(anyPrizeProbability(LOTTO535), rational(expected, T))).toBe(true);
  });
});

describe('Power 6/55 — Jackpot 1, Jackpot 2 và số đặc biệt', () => {
  const T = 28989675n;
  const p = byCode(POWER655 as typeof LOTTO535);
  it('Jackpot 1 = 1/28.989.675', () => expect(rEq(p.jackpot1, rational(1n, T))).toBe(true));
  it('Jackpot 2 = 6/T (5 số + số đặc biệt quay từ 49 số còn lại)', () => expect(rEq(p.jackpot2, rational(6n, T))).toBe(true));
  it('Nhất = (6·49 − 6)/T = 288/T', () => expect(rEq(p.first, rational(288n, T))).toBe(true));
  it('Nhì = C(6,4)·C(49,2)/T = 17640/T', () => expect(rEq(p.second, rational(17640n, T))).toBe(true));
  it('Ba = C(6,3)·C(49,3)/T = 368480/T', () => expect(rEq(p.third, rational(368480n, T))).toBe(true));
  it('Jackpot 1 KHÔNG bị nhầm với Jackpot 2 (Jackpot đầu tiên là 6 số)', () => {
    expect(rEq(jackpotProbability(POWER655), rational(1n, T))).toBe(true);
  });
});

describe('Kỳ vọng & nhiều vé / nhiều kỳ', () => {
  it('EV Power 6/55 = Σ p·giá trị (tính tay)', () => {
    const T = 28989675;
    const expected = (1 * 30e9 + 6 * 3e9 + 288 * 40e6 + 17640 * 500e3 + 368480 * 50e3) / T;
    expect(expectedValue(POWER655).expectedPrize).toBeCloseTo(expected, 6);
  });
  it('EV Lotto 5/35 < giá vé (kỳ vọng âm)', () => {
    const ev = expectedValue(LOTTO535);
    expect(ev.expectedNet).toBeLessThan(0);
    expect(ev.returnRatio).toBeLessThan(1);
  });
  it('T vé khác nhau ⇒ P(Jackpot) = T/tổng', () => {
    expect(rEq(jackpotProbabilityForDistinctTickets(LOTTO535, 10), rational(10n, 3895584n))).toBe(true);
  });
  it('1 − (1 − p)^n: n=2, p=1/2 ⇒ 3/4', () => {
    expect(rEq(atLeastOneAcrossIndependent(rational(1n, 2n), 2), rational(3n, 4n))).toBe(true);
    expect(rToNumber(atLeastOneAcrossIndependent(rational(1n, 3895584n), 104))).toBeCloseTo(1 - (1 - 1 / 3895584) ** 104, 12);
  });
});
