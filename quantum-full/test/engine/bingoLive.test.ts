import { describe, expect, it } from 'vitest';
import { bingoSchedule, isBingoDrawTime, livePlan, prizeFor, type LiveConfig } from '../../src/engine/bingoLive';

const vn = (date: string, time: string) => new Date(`${date}T${time}+07:00`).toISOString();
const cfg: LiveConfig = { bet: { type: 'single', value: 1 }, baseUnits: 1, budget: 50_000, takeProfit: 30_000, maxMinutes: 60, startedAt: vn('2026-11-27', '08:00:00') };
const ctx = (time: string, spentToday = 0) => ({ now: vn('2026-11-27', time), spentToday, dailyLimit: 100_000 });

describe('Lịch quay Bingo18 (6 phút, 06:00 đến 21:48, ngừng bán trước 1 phút)', () => {
  it('Kỳ kế tiếp, thời gian còn lại, số kỳ', () => {
    const s = bingoSchedule(vn('2026-11-27', '08:31:30'));
    expect(s.nextDrawAt).toBe('08:36');
    expect(s.lastDrawAt).toBe('08:30');
    expect(s.secondsToCutoff).toBe(3 * 60 + 30);
    expect(s.secondsToDraw).toBe(4 * 60 + 30);
    expect(s.perDay).toBe(159);
    // 08:35:30 đã qua giờ ngừng bán kỳ 08:36 ⇒ kỳ kế tiếp là 08:42
    expect(bingoSchedule(vn('2026-11-27', '08:35:30')).nextDrawAt).toBe('08:42');
    expect(bingoSchedule(vn('2026-11-27', '05:00:00')).nextDrawAt).toBe('06:00');
    expect(bingoSchedule(vn('2026-11-27', '21:52:30')).nextDrawAt).toBeNull();
  });
  it('Giờ quay hợp lệ', () => {
    expect(isBingoDrawTime('06:00')).toBe(true);
    expect(isBingoDrawTime('21:53')).toBe(false);
    expect(isBingoDrawTime('21:48')).toBe(true);
    expect(isBingoDrawTime('21:54')).toBe(false);
    expect(isBingoDrawTime('08:37')).toBe(false);
  });
});

describe('Chốt phương án từng kỳ', () => {
  it('Mặc định: CHƠI mức gốc, không tăng sau khi thua', () => {
    const p = livePlan(cfg, [{ drawAt: '08:00', stake: 10_000, prize: 0, result: [2, 3, 4] }], ctx('08:01:00'));
    expect(p.action).toBe('play');
    expect(p.stake).toBe(10_000);
    expect(p.headline).toBe('KỲ 08:06: CHƠI 10.000đ CỬA CHỌN SỐ 1');
    expect(p.net).toBe(-10_000);
    expect(p.lossRoomLeft).toBe(40_000);
  });
  it('DỪNG khi đạt chốt lời, chạm lỗ tối đa, hết hạn mức ngày, hết thời gian, hết kỳ', () => {
    expect(livePlan(cfg, [{ drawAt: '08:00', stake: 10_000, prize: 40_000, result: null }], ctx('08:01:00')).headline).toMatch(/CHỐT LỜI/);
    const losses = Array.from({ length: 5 }, (_, i) => ({ drawAt: `08:${String(i * 6).padStart(2, '0')}`, stake: 10_000, prize: 0, result: null }));
    expect(livePlan(cfg, losses, ctx('08:30:00')).headline).toMatch(/LỖ TỐI ĐA/);
    expect(livePlan(cfg, [], ctx('08:01:00', 95_000)).headline).toMatch(/HẠN MỨC CHI/);
    expect(livePlan(cfg, [], ctx('09:01:00')).headline).toMatch(/HẾT THỜI GIAN/);
    expect(livePlan({ ...cfg, maxMinutes: 960 }, [], ctx('21:53:30')).headline).toMatch(/HẾT KỲ QUAY/);
    for (const p of [livePlan(cfg, losses, ctx('08:30:00'))]) expect(p.stake).toBe(0);
  });
  it('Tính thưởng theo kết quả 3 số và số lần tham gia', () => {
    expect(prizeFor({ type: 'single', value: 1 }, 10_000, [1, 2, 3])).toBe(12_000);
    expect(prizeFor({ type: 'single', value: 1 }, 20_000, [1, 1, 3])).toBe(40_000);
    expect(prizeFor({ type: 'big' }, 10_000, [6, 6, 2])).toBe(15_000);
    expect(prizeFor({ type: 'big' }, 10_000, [1, 2, 3])).toBe(0);
  });
});
