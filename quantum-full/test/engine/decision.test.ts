import { describe, expect, it } from 'vitest';
import { afterTax, candidateDraws, daysLeftInMonth, decideToday, evaluateTicketValue, vnClock, type DecisionGame } from '../../src/engine/decision';
import { LOTTO535, POWER655 } from '../fixtures';

const lotto: DecisionGame = { ...LOTTO535, code: 'lotto535', name: 'Lotto 5/35', schedule: { times: ['13:00', '21:00'], cutoffMinutes: 15 }, jackpots: {}, jackpotsUpdatedAt: null };
const power: DecisionGame = { ...POWER655, code: 'power655', name: 'Power 6/55', schedule: { weekdays: [2, 4, 6], times: ['18:00'], cutoffMinutes: 15 }, jackpots: {}, jackpotsUpdatedAt: null };
const base = { games: [lotto, power], mode: 'discipline' as const, valueThreshold: 0.5, budgetPerDraw: 100000, monthRemaining: 1000000, yearRemaining: 12000000, spentToday: 0, applyTax: true };

describe('Thuế & kỳ vọng', () => {
  it('Thuế 10% trên phần vượt 10 triệu', () => {
    expect(afterTax(40_000_000, true)).toBe(37_000_000);
    expect(afterTax(5_000_000, true)).toBe(5_000_000);
    expect(afterTax(40_000_000, false)).toBe(40_000_000);
  });
  it('EV Power trước thuế khớp công thức tay; Jackpot lớn hơn ⇒ EV cao hơn', () => {
    const T = 28989675;
    const pre = evaluateTicketValue(power, false);
    expect(pre.expectedPrize).toBeCloseTo((30e9 + 6 * 3e9 + 288 * 40e6 + 17640 * 500e3 + 368480 * 50e3) / T, 6);
    const big = evaluateTicketValue({ ...power, jackpots: { jackpot1: 200e9 } }, true);
    expect(big.returnRatio).toBeGreaterThan(evaluateTicketValue(power, true).returnRatio);
  });
  it('Jackpot hoà vốn làm EV sau thuế = giá vé', () => {
    const v = evaluateTicketValue(power, true);
    const atBe = evaluateTicketValue({ ...power, jackpots: { jackpot1: v.breakEvenJackpot! } }, true);
    expect(atBe.expectedPrize).toBeCloseTo(10000, 3);
  });
});

describe('Lịch & ngân sách', () => {
  it('Giờ Việt Nam, số ngày còn lại trong tháng', () => {
    expect(vnClock('2026-11-20T05:50:00Z')).toEqual({ date: '2026-11-20', minutes: 12 * 60 + 50, weekday: 5 });
    expect(daysLeftInMonth('2026-11-20')).toBe(11);
    expect(daysLeftInMonth('2026-02-28')).toBe(1);
  });
  it('Thứ Sáu 12:50: kỳ 13:00 đã ngừng bán, Power không quay ⇒ chỉ còn Lotto 21:00', () => {
    const c = candidateDraws({ ...base, now: '2026-11-20T05:50:00Z' });
    expect(c.map((x) => `${x.game} ${x.time}`)).toEqual(['lotto535 21:00']);
  });
  it('Thứ Bảy sáng: so sánh Lotto 13:00/21:00 với Power 18:00 theo kỳ vọng', () => {
    const c = candidateDraws({ ...base, games: [lotto, { ...power, jackpots: { jackpot1: 300e9 } }], now: '2026-11-21T01:00:00Z' });
    expect(c.length).toBe(3);
    expect(c[0].game).toBe('power655'); // Jackpot 300 tỷ ⇒ kỳ vọng cao hơn
  });
});

describe('Quyết định', () => {
  it('Kỷ luật: ngân sách khả dụng = min(hạn mức kỳ, tháng còn lại ÷ số ngày, năm) − đã chi', () => {
    const d = decideToday({ ...base, now: '2026-11-20T05:50:00Z', monthRemaining: 300000 });
    expect(d.allowance.dailyFromMonth).toBe(27272);
    expect(d.action).toBe('buy');
    expect(d.tickets).toBe(2);
    expect(d.cost).toBe(20000);
    expect(d.expectedLoss).toBeGreaterThan(0);
  });
  it('Đã chi đủ hôm nay ⇒ không mua (không Martingale)', () => {
    const d = decideToday({ ...base, now: '2026-11-20T05:50:00Z', spentToday: 100000 });
    expect(d.action).toBe('skip');
  });
  it('Chế độ giá trị: bỏ qua khi tỷ lệ hoàn vốn dưới ngưỡng', () => {
    const d = decideToday({ ...base, mode: 'value', valueThreshold: 0.9, now: '2026-11-20T05:50:00Z' });
    expect(d.action).toBe('skip');
    expect(d.headline).toContain('GIÁ TRỊ KỲ VỌNG THẤP');
  });
  it('Chế độ tối thiểu: 1 vé', () => {
    expect(decideToday({ ...base, mode: 'minimal', now: '2026-11-20T05:50:00Z' }).tickets).toBe(1);
  });
  it('Hết giờ bán trong ngày ⇒ không mua', () => {
    expect(decideToday({ ...base, now: '2026-11-20T14:00:00Z' }).action).toBe('skip');
  });
});

describe('Kỳ Chia giải Độc đắc trong quyết định', () => {
  const split = { game: 'lotto535', date: '2026-11-20', time: '21:00', jackpot: 16e9, shares: { first: 2 / 6, second: 1 / 6, third: 1 / 6, fourth: 1 / 6, fifth: 1 / 6 }, tickets: 0.9e6, ticketsConservative: 1.2e6 };
  const now = '2026-11-20T05:50:00Z'; // 12:50 giờ VN ⇒ còn kỳ 21:00

  it('Kỳ chia giải có kỳ vọng thận trọng > 100% và được xếp đầu', () => {
    const c = candidateDraws({ ...base, now, split });
    expect(c[0].split).not.toBeNull();
    expect(c[0].returnRatio).toBeGreaterThan(1);
    expect(c[0].split!.returnRatioEstimate).toBeGreaterThan(c[0].returnRatio);
    expect(c[0].expectedLossPerTicket).toBeLessThan(0);
  });

  it('Chế độ split_only: mua kỳ chia giải bằng ngân sách tích luỹ (không chia theo ngày)', () => {
    const d = decideToday({ ...base, mode: 'split_only', now, split, monthRemaining: 300000 });
    expect(d.action).toBe('buy');
    expect(d.pick!.split).not.toBeNull();
    expect(d.tickets).toBe(10); // min(100.000 hạn mức kỳ, 300.000 tháng còn lại) ⇒ 10 vé, không phải 27.272đ/ngày
    expect(d.expectedReturn).toBeGreaterThan(d.cost);
  });

  it('Chế độ split_only: không có kỳ chia giải hoặc kỳ vọng thận trọng < 100% ⇒ không mua', () => {
    expect(decideToday({ ...base, mode: 'split_only', now }).action).toBe('skip');
    const crowded = { ...split, tickets: 3e6, ticketsConservative: 4e6 };
    const d = decideToday({ ...base, mode: 'split_only', now, split: crowded });
    expect(d.action).toBe('skip');
    expect(d.reasons[0]).toMatch(/chưa vượt giá vé/);
  });

  it('Kỳ chia giải ngày khác không ảnh hưởng hôm nay', () => {
    const c = candidateDraws({ ...base, now, split: { ...split, date: '2026-11-21' } });
    expect(c.every((x) => x.split === null)).toBe(true);
  });
});
