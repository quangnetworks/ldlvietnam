import { describe, expect, it } from 'vitest';
import { api, VIEWER } from './helpers';

// Số người trúng kỳ chia giải 17/7/2025 suy từ tin báo (Nhì 24 vé; Ba/Tư/Năm suy từ tiền thưởng) — chỉ dùng trong test.
const reference = { second: 24, third: 490, fourth: 765, fifth: 11900 };
const body = { game: 'lotto535', date: '2026-11-20', time: '21:00', jackpot: 16_900_000_000, reference_winners: reference, sales_growth: 0.3 };
const now = '2026-11-20T05:50:00.000Z'; // 12:50 giờ Việt Nam

describe('API kỳ Chia giải Độc đắc', () => {
  it('Xác nhận kỳ chia giải ⇒ ước lượng số vé, kỳ vọng > 100%, chế độ split_only khuyên mua', async () => {
    const r = await api('/admin/split-draw', { method: 'PUT', body });
    expect(r.status).toBe(200);
    const s = r.body.data.split;
    expect(s.config.date).toBe('2026-11-20');
    expect(s.estimate.tickets).toBeGreaterThan(800_000);
    expect(s.estimate.tickets).toBeLessThan(1_100_000);
    expect(s.ticketsConservative).toBe(Math.round(s.tickets * 1.3));
    expect(s.returnRatioEstimate).toBeGreaterThan(s.returnRatioConservative);
    expect(s.returnRatioConservative).toBeGreaterThan(1);
    expect(s.breakEvenTickets).toBeGreaterThan(s.ticketsConservative);

    const d = await api(`/decision/today?mode=split_only&now=${now}`, { token: VIEWER });
    expect(d.status).toBe(200);
    expect(d.body.data.decision.action).toBe('buy');
    expect(d.body.data.decision.pick.split).not.toBeNull();
    expect(d.body.data.decision.headline).toMatch(/KỲ CHIA GIẢI 21:00/);

    // Ngày khác ⇒ split_only không mua
    const other = await api('/decision/today?mode=split_only&now=2026-11-22T05:50:00.000Z');
    expect(other.body.data.decision.action).toBe('skip');
  });

  it('Kiểm tra dữ liệu đầu vào và quyền', async () => {
    const noRef = { ...body, reference_winners: undefined };
    expect((await api('/admin/split-draw', { method: 'PUT', body: noRef })).status).toBe(400);
    expect((await api('/admin/split-draw', { method: 'PUT', body: { ...noRef, tickets_override: 1_500_000 } })).status).toBe(200);
    expect((await api('/admin/split-draw', { method: 'PUT', body: { ...body, time: '20:00' } })).status).toBe(400);
    expect((await api('/admin/split-draw', { method: 'PUT', body: { ...body, jackpot: 1_000_000 } })).status).toBe(400);
    expect((await api('/admin/split-draw', { method: 'PUT', body: { ...body, reference_winners: { khong_co: 3 } } })).status).toBe(400);
    expect((await api('/admin/split-draw', { method: 'PUT', body: { ...body, shares: { first: 0.5 } } })).status).toBe(400);
    expect((await api('/admin/split-draw', { method: 'PUT', body: { ...body, game: 'khong-co' } })).status).toBe(404);
    expect((await api('/admin/split-draw', { method: 'PUT', body, token: VIEWER })).status).toBe(403);
    expect((await api('/admin/split-draw', { method: 'PUT', body, token: null })).status).toBe(401);
  });

  it('Xoá cấu hình ⇒ không còn kỳ chia giải; có ghi nhật ký kiểm toán', async () => {
    await api('/admin/split-draw', { method: 'PUT', body });
    const del = await api('/admin/split-draw', { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(del.body.data.split.config).toBeNull();
    const audit = await api('/audit?action=split_draw');
    expect(audit.status).toBe(200);
    expect(audit.body.data.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['split_draw.update', 'split_draw.clear']));
  });
});
