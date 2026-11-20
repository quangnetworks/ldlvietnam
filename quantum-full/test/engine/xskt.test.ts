import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/engine/rng';
import { REGIONS, numbersPerDraw, regionValue, slotDigits, ticketPayout, xsktAudit, xsktModels, type Region } from '../../src/engine/xskt';
import { digitStr, synthXskt } from '../xsktFixtures';

describe('XSKT — cơ cấu giải & giá trị vé', () => {
  it('Số lượng số mỗi kỳ: Bắc 27, Nam/Trung 18', () => {
    expect(numbersPerDraw('mb')).toBe(27);
    expect(numbersPerDraw('mn')).toBe(18);
    expect(numbersPerDraw('mt')).toBe(18);
  });

  it('Kỳ vọng chính xác: Nam/Trung 5.000đ (50%), Bắc 4.990đ (49,9%); số giải mỗi loại vé khớp thể lệ', () => {
    const mn = regionValue('mn');
    expect(mn.expectedPrize).toBeCloseTo(5000, 6);
    const per = Object.fromEntries(mn.tiers.map((t) => [t.code, Math.round(t.perSeries)]));
    expect(per).toMatchObject({ special: 1, runner_up: 9, consolation: 45, first: 10, second: 10, third: 20, fourth: 70, fifth: 100, sixth: 300, seventh: 1000, eighth: 10000 });
    const mb = regionValue('mb');
    expect(mb.expectedPrize).toBeCloseTo(4990, 6);
    expect(Math.round(mb.tiers.find((t) => t.code === 'consolation')!.perSeries)).toBe(1000);
    expect(mb.returnRatioAfterTax).toBeLessThan(mb.returnRatio);
  });

  it('Chấm vé Nam/Trung: đặc biệt, phụ đặc biệt, khuyến khích, cộng dồn giải nhỏ', () => {
    // Thứ tự: ĐB, Nhất, Nhì, Ba×2, Tư×7, Năm, Sáu×3, Bảy, Tám
    const full = ['123456', '00001', '00002', '00003', '00004', '00005', '00006', '00007', '00008', '00009', '00010', '00011', '1111', '2222', '3333', '4444', '456', '56'];
    expect(full.length).toBe(18);
    const win = ticketPayout('mn', '123456', full);
    expect(win.lines.map((l) => l.code).sort()).toEqual(['eighth', 'seventh', 'special']);
    expect(win.total).toBe(2_000_000_000 + 200_000 + 100_000);
    expect(ticketPayout('mn', '923456', full).lines.map((l) => l.code)).toContain('runner_up');
    expect(ticketPayout('mn', '123450', full).lines.map((l) => l.code)).toEqual(['consolation']);
    expect(ticketPayout('mn', '123400', full).total).toBe(0);
    expect(ticketPayout('mn', '999999', full).total).toBe(0);
    expect(ticketPayout('mn', '700005', full).lines.map((l) => l.code)).toEqual(['fourth']);
    expect(() => ticketPayout('mn', '12345', full)).toThrow();
  });

  it('Chấm vé Bắc: trùng 5 số ĐB ⇒ kỳ vọng theo ký hiệu + khuyến khích 2 số cuối', () => {
    const draw = slotDigits('mb').map((d, i) => (i === 0 ? '12345' : '9'.repeat(d)));
    const r = ticketPayout('mb', '12345', draw);
    expect(r.total).toBeCloseTo((6 / 15) * 500e6 + (9 / 15) * 25e6 + 40_000, 6);
    expect(ticketPayout('mb', '00045', draw).lines.map((l) => l.code)).toEqual(['consolation']);
    // Đuôi '99' trùng cả 4 số giải Bảy ⇒ cộng dồn 4 × 40.000đ
    expect(ticketPayout('mb', '00099', draw).total).toBe(160_000);
  });

  it('P(trúng ≥ 1 giải) khớp mô phỏng ngẫu nhiên', () => {
    const rng = createRng('xskt-pany');
    for (const region of ['mn', 'mb'] as Region[]) {
      const p = regionValue(region).pAnyPrize;
      const digits = slotDigits(region);
      let win = 0;
      const N = 40000;
      for (let i = 0; i < N; i++) {
        const draw = digits.map((d) => digitStr(rng, d));
        if (ticketPayout(region, digitStr(rng, REGIONS[region].ticketDigits), draw).total > 0) win++;
      }
      const se = Math.sqrt((p * (1 - p)) / N);
      expect(Math.abs(win / N - p)).toBeLessThan(4 * se);
    }
  });
});

describe('XSKT — kiểm định ngẫu nhiên', () => {
  it('Dưới 200 kỳ ⇒ chưa đủ dữ liệu', () => {
    expect(xsktAudit('mn', synthXskt('mn', ['A'], 50, 'small')).verdict).toBe('insufficient');
  });

  it('Lịch sử đồng đều ⇒ khớp ngẫu nhiên (tỷ lệ báo động giả ≈ mức FDR 5%); có kiểm định theo từng đài', () => {
    const verdicts = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].map((seed) => xsktAudit('mn', synthXskt('mn', ['Đài A', 'Đài B', 'Đài C'], 300, seed)).verdict);
    expect(verdicts.filter((v) => v !== 'random').length).toBeLessThanOrEqual(1);
    const a = xsktAudit('mn', synthXskt('mn', ['Đài A', 'Đài B', 'Đài C'], 300, 's1'));
    expect(a.verdict).toBe('random');
    expect(a.stationAudits.map((s) => s.station).sort()).toEqual(['Đài A', 'Đài B', 'Đài C']);
    expect(a.tests.some((t) => t.code === 'last2_uniform')).toBe(true);
  });

  it('Chữ số hàng đơn vị bị lệch ⇒ phát hiện bất thường', () => {
    const draws = synthXskt('mn', ['Đài A', 'Đài B'], 400, 'biased-mn', { bias: (rng, pos) => (pos === 1 && rng.next() < 0.08 ? 7 : null) });
    const a = xsktAudit('mn', draws);
    expect(a.verdict).toBe('anomaly');
    expect(a.tests.find((t) => t.code === 'digit_pos_1')!.significant).toBe(true);
  });

  it('Không lặp số trong cùng giải (Bắc) ⇒ ghi nhận là quy tắc quay, không phải bất thường', () => {
    const a = xsktAudit('mb', synthXskt('mb', ['Miền Bắc'], 1500, 'mb-rule', { noTierRepeat: true }));
    const rule = a.tests.find((t) => t.code === 'within_tier_duplicates')!;
    expect(rule.structural).toBe(true);
    expect(rule.significant).toBe(false);
    expect(a.verdict).toBe('random');
    expect(a.explanation.join(' ')).toMatch(/quy tắc quay/);
  });
});

describe('XSKT — mô hình dự báo walk-forward', () => {
  it('Lịch sử đồng đều ⇒ không mô hình nào vượt ngẫu nhiên', () => {
    const m = xsktModels('mt', synthXskt('mt', ['Đài A', 'Đài B'], 200, 'uniform-mt'));
    expect(m.verdict).toBe('no_edge');
    expect(m.models.map((x) => x.code)).toEqual(['uniform', 'hot', 'cold', 'bayes', 'markov', 'ensemble']);
    expect(m.models[0].logLoss).toBeCloseTo(Math.log(10), 9);
    expect(m.models.every((x) => !x.beatsBaseline)).toBe(true);
    expect(m.expectedPayout).toBeCloseTo(5000, 6);
  });

  it('Chữ số bị lệch mạnh ⇒ mô hình Nóng/Bayes phát hiện được (chứng minh bộ chấm hoạt động)', () => {
    const draws = synthXskt('mn', ['Đài A'], 300, 'edge-mn', { bias: (rng, pos) => (pos === 1 && rng.next() < 0.3 ? 7 : null) });
    const m = xsktModels('mn', draws);
    expect(m.verdict).toBe('edge');
    const bayes = m.models.find((x) => x.code === 'bayes')!;
    expect(bayes.beatsBaseline).toBe(true);
    expect(bayes.unitsHitRate).toBeGreaterThan(0.25);
  });

  it('Không nhìn trước: kỳ đầu tiên của mỗi đài không được chấm (warmup)', () => {
    const m = xsktModels('mn', synthXskt('mn', ['A', 'B'], 120, 'warm'), { window: 30, warmup: 30 });
    expect(m.models[0].draws).toBe(2 * (120 - 30));
  });
});
