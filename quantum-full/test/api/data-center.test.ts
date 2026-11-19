import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { api, importAndVerify, syntheticCsv } from './helpers';
import { LOTTO535, POWER655 } from '../fixtures';

const csv = (rows: string[]) => ['draw_code,draw_date,draw_time,numbers,special', ...rows].join('\n');

describe('Data Center — import có kiểm soát', () => {
  it('CSV: nhận dòng hợp lệ, từ chối sai miền/trùng/tương lai, ghi import job + audit', async () => {
    const r = await api('/admin/draws/import', {
      body: {
        game: 'lotto535',
        format: 'csv',
        data_source_id: 1,
        source_url: 'https://vietlott.vn/example',
        content: csv([
          '00001,2025-07-01,13:00,01 02 03 04 05,07',
          '00002,2025-07-01,21:00,05-10-15-20-35,12',
          '00003,2025-07-02,13:00,01 02 03 04 36,01', // sai miền
          '00004,2025-07-02,21:00,01 01 03 04 05,01', // trùng số
          '00005,2025-07-03,13:00,01 02 03 04 05,13', // số đặc biệt sai miền
          '00006,2099-01-01,13:00,01 02 03 04 05,01', // tương lai
          '00001,2025-07-01,13:00,01 02 03 04 05,07', // lặp trong payload
        ]),
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'partial', inserted: 2, invalid: 5, totalRows: 7 });
    const codes = r.body.data.errors.map((e: { code: string }) => e.code);
    expect(codes).toEqual(expect.arrayContaining(['main_out_of_range', 'main_duplicate', 'special_out_of_range', 'future_date', 'duplicate_in_payload']));
    const job = await api('/import-jobs?game=lotto535');
    expect(job.body.data[0]).toMatchObject({ inserted: 2, status: 'partial', source_url: 'https://vietlott.vn/example' });
    expect(job.body.data[0].payload_hash).toMatch(/^[0-9a-f]{64}$/);
    const list = await api('/draws?game=lotto535');
    expect(list.body.data[0]).toMatchObject({ drawCode: '00002', main: [5, 10, 15, 20, 35], special: 12, verificationStatus: 'unverified', sourceKind: 'official' });
    expect(list.body.data[0].sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(list.body.data[0].drawAt).toBe('2025-07-01T14:00:00.000Z');
    const audit = await api('/audit?action=draws.import');
    expect(audit.body.data.length).toBe(1);
  });

  it('Nhập lại: trùng nội dung ⇒ duplicates; khác nội dung ⇒ conflict, KHÔNG ghi đè', async () => {
    const body = (content: string) => ({ game: 'lotto535', format: 'csv', data_source_id: 1, content });
    await api('/admin/draws/import', { body: body(csv(['A1,2025-07-01,13:00,01 02 03 04 05,07'])) });
    const again = await api('/admin/draws/import', { body: body(csv(['A1,2025-07-01,13:00,05 04 03 02 01,07'])) });
    expect(again.body.data).toMatchObject({ inserted: 0, duplicates: 1, conflicts: 0 });
    const diff = await api('/admin/draws/import', { body: body(csv(['A1,2025-07-01,13:00,01 02 03 04 06,07'])) });
    expect(diff.body.data).toMatchObject({ inserted: 0, conflicts: 1, status: 'failed' });
    const d = await api('/draws?game=lotto535&q=A1');
    expect(d.body.data[0].main).toEqual([1, 2, 3, 4, 5]);
  });

  it('JSON import cho Power 6/55 kiểm tra số đặc biệt quay từ số chính còn lại', async () => {
    const r = await api('/admin/draws/import', {
      body: {
        game: 'power655',
        format: 'json',
        data_source_id: 1,
        content: JSON.stringify([
          { draw_code: '01000', draw_date: '2025-06-03', main: [3, 14, 22, 37, 41, 55], special: 9 },
          { draw_code: '01001', draw_date: '2025-06-05', main: [3, 14, 22, 37, 41, 55], special: 41 },
        ]),
      },
    });
    expect(r.body.data.inserted).toBe(1);
    expect(r.body.data.errors[0].code).toBe('special_duplicates_main');
  });

  it('Nhập tay + xác minh + điều chỉnh có audit (trước/sau)', async () => {
    const m = await api('/admin/draws', { body: { game: 'power655', draw_code: '01100', draw_date: '2025-06-07', draw_time: '18:00', main: [1, 2, 3, 4, 5, 6], special: 7 } });
    expect(m.status).toBe(201);
    const id = (await api('/draws?game=power655&q=01100')).body.data[0].id;
    const v = await api(`/admin/draws/${id}/verify`, { body: { status: 'verified' } });
    expect(v.body.data).toMatchObject({ verificationStatus: 'verified', verifiedBy: 'token:admin' });
    // Bỏ xác minh cần lý do
    expect((await api(`/admin/draws/${id}/verify`, { body: { status: 'unverified' } })).status).toBe(400);
    // Điều chỉnh: lý do bắt buộc ≥ 10 ký tự
    expect((await api(`/admin/draws/${id}/correct`, { body: { main: [1, 2, 3, 4, 5, 8], special: 7, reason: 'ngắn' } })).status).toBe(400);
    const corr = await api(`/admin/draws/${id}/correct`, { body: { main: [1, 2, 3, 4, 5, 8], special: 7, reason: 'Đối chiếu lại bảng kết quả chính thức' } });
    expect(corr.status).toBe(200);
    expect(corr.body.data.draw).toMatchObject({ main: [1, 2, 3, 4, 5, 8], verificationStatus: 'unverified' });
    const audit = await api('/audit?action=draws.correct');
    expect(audit.body.data[0].before.main).toEqual([1, 2, 3, 4, 5, 6]);
    expect(audit.body.data[0].after.main).toEqual([1, 2, 3, 4, 5, 8]);
  });

  it('Validation API: body sai ⇒ 400 có chi tiết; phân trang', async () => {
    const r = await api('/admin/draws/import', { body: { game: 'lotto535', format: 'xml' } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation_error');
    const before = (await api('/draws?game=lotto535&status=verified')).body.meta.total;
    await importAndVerify('lotto535', LOTTO535, 25, 'page');
    const p = await api('/draws?game=lotto535&page=2&page_size=10&status=verified');
    expect(p.body.meta).toMatchObject({ page: 2, page_size: 10, total: before + 25, total_pages: Math.ceil((before + 25) / 10) });
    expect(p.body.data.length).toBe(10);
    expect((await api('/draws?game=lotto535&page_size=1000')).status).toBe(400);
  });

  it('Thống kê chỉ dùng dữ liệu đã xác minh (mặc định) và báo cỡ mẫu', async () => {
    const base = await api('/statistics/frequency?game=power655');
    const baseAll = await api('/statistics/frequency?game=power655&include_unverified=true');
    expect(base.body.meta.draws).toBe(0); // các kỳ Power trước đó trong file chưa xác minh
    await importAndVerify('power655', POWER655, 60, 'stats');
    await api('/admin/draws/import', { body: { game: 'power655', format: 'csv', data_source_id: 2, content: syntheticCsv(POWER655, 5, 'unv') } });
    const f = await api('/statistics/frequency?game=power655');
    expect(f.status).toBe(200);
    expect(f.body.meta.draws).toBe(60);
    expect(f.body.data.numbers.reduce((s: number, x: { count: number }) => s + x.count, 0)).toBe(360);
    expect(f.body.data.disclaimer).toContain('KHÔNG');
    const all = await api('/statistics/frequency?game=power655&include_unverified=true');
    expect(all.body.meta.draws).toBe(baseAll.body.meta.draws + 65);
    for (const ep of ['distribution', 'pairs', 'triplets', 'summary']) expect((await api(`/statistics/${ep}?game=power655`)).status).toBe(200);
    const raw = await env.DB.prepare("SELECT COUNT(*) AS n FROM draws WHERE verification_status = 'verified' AND game_id = 2").first<{ n: number }>();
    expect(raw!.n).toBe(60);
  });
});
