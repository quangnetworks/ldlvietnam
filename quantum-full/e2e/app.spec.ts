import { expect, test } from '@playwright/test';
import { login, syntheticCsv } from './helpers';

test.describe.configure({ mode: 'serial' });

test('Mọi trang trong sidebar hiển thị, không lỗi console, không có số liệu dựng sẵn', async ({ page }) => {
  await login(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible();
  await expect(page.getByText('Hãy nhập kết quả quay chính thức')).toBeVisible();
  const pages: [string, string][] = [
    ['Quyết định hôm nay', 'Quyết định hôm nay'],
    ['Bingo18', 'Bingo18'],
    ['Xổ số kiến thiết', 'Xổ số kiến thiết'],
    ['Data Center', 'Data Center'],
    ['Thống kê', 'Statistical Intelligence'],
    ['Kiểm định dự đoán', 'Kiểm định dự đoán'],
    ['AI Research', 'AI Research'],
    ['Sinh bộ số', 'Number Generator'],
    ['Danh mục vé', 'Danh mục vé'],
    ['Backtesting', 'Backtesting Center'],
    ['Kiểm soát vốn', 'Kiểm soát vốn'],
    ['Kiểm toán mô hình', 'Kiểm toán mô hình'],
    ['Cài đặt', 'Cài đặt'],
  ];
  for (const [nav, heading] of pages) {
    await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: nav }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('Data Center: nhập CSV, báo lỗi dòng sai, xác minh dữ liệu', async ({ page }) => {
  await login(page);
  await page.goto('/data');
  await expect(page.getByText('Nguồn dữ liệu mở')).toBeVisible();
  await page.getByRole('tab', { name: 'Nhập dữ liệu' }).click();
  const csv = `${syntheticCsv(160)}\nBAD-1,2024-12-01,13:00,01 02 03 04 99,01`;
  await page.getByRole('textbox', { name: /Nội dung/ }).fill(csv);
  await page.getByRole('button', { name: 'Nhập dữ liệu' }).click();
  await expect(page.getByText('Thêm mới 160')).toBeVisible();
  await expect(page.getByText(/Số 99 ngoài miền/)).toBeVisible();
  await page.getByRole('tab', { name: 'Kết quả quay' }).click();
  await page.getByLabel('Lọc trạng thái').selectOption('unverified');
  for (let i = 0; i < 10; i++) {
    const empty = page.getByText('Chưa có kết quả quay');
    const firstRow = page.getByRole('checkbox', { name: /Chọn kỳ/ }).first();
    await expect(empty.or(firstRow)).toBeVisible();
    if (await empty.isVisible()) break;
    await page.getByRole('button', { name: 'Chọn chưa xác minh' }).click();
    const reloaded = page.waitForResponse((r) => r.url().includes('/api/v1/draws?') && r.request().method() === 'GET');
    await page.getByRole('button', { name: /Xác minh \(\d+\)/ }).click();
    await reloaded;
  }
  await expect(page.getByText('Chưa có kết quả quay')).toBeVisible();
  await expect(page.getByText(/Đã xác minh 160 ·/)).toBeVisible();
});

test('Tổng quan & Thống kê tính từ dữ liệu đã xác minh', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await expect(page.getByText('Kỳ quay đã xác minh')).toBeVisible();
  await expect(page.getByRole('img', { name: /Bản đồ nhiệt/ })).toBeVisible();
  await page.goto('/statistics');
  await expect(page.getByText(/Cỡ mẫu: 160 kỳ/)).toBeVisible();
  await page.getByRole('tab', { name: 'Cặp & bộ ba' }).click();
  await expect(page.getByText('Cặp số xuất hiện nhiều nhất')).toBeVisible();
});

test('Sinh bộ số: đúng miền số, không vượt ngân sách, lưu danh mục', async ({ page }) => {
  await login(page);
  await page.goto('/generator');
  await page.getByLabel('Chiến lược').selectOption('portfolio_optimized');
  await page.getByLabel('Số vé').fill('10');
  await page.getByRole('button', { name: 'Sinh bộ số' }).click();
  await expect(page.getByText(/10 bộ số · Tối ưu danh mục/)).toBeVisible();
  const balls = await page.getByLabel(/^Số \d\d$/).allTextContents();
  expect(balls.length).toBe(50);
  for (const b of balls) expect(Number(b)).toBeGreaterThanOrEqual(1), expect(Number(b)).toBeLessThanOrEqual(35);
  const specials = await page.getByLabel(/^Số đặc biệt \d\d$/).allTextContents();
  expect(specials.length).toBe(10);
  for (const b of specials) expect(Number(b)).toBeLessThanOrEqual(12);
  await expect(page.getByText('100.000đ').first()).toBeVisible();
  // Xác suất CHÍNH XÁC của cả danh mục (liệt kê toàn bộ kết quả quay)
  await expect(page.getByText('Xác suất chính xác của cả danh mục')).toBeVisible();
  await expect(page.getByText(/Liệt kê toàn bộ 3\.895\.584 kết quả quay có thể/)).toBeVisible();
  await expect(page.getByText(/Chọn ngẫu nhiên độc lập: \d/)).toBeVisible();
  // Vượt hạn mức mỗi kỳ ⇒ nút bị khoá
  await page.getByLabel('Số vé').fill('11');
  await expect(page.getByRole('button', { name: 'Sinh bộ số' })).toBeDisabled();
  await page.getByLabel('Số vé').fill('10');
  await page.getByRole('button', { name: 'Lưu danh mục' }).click();
  await page.getByRole('button', { name: 'Xác nhận lưu' }).click();
  await expect(page.getByText(/Đã lưu danh mục #\d+/)).toBeVisible();
  await page.goto('/portfolio');
  await page.getByRole('tab', { name: 'Danh mục đã lưu' }).click();
  await expect(page.getByRole('cell', { name: /Danh mục/ }).first()).toBeVisible();
});

test('Backtesting chạy tới khi hoàn tất và hiển thị kết luận so với baseline', async ({ page }) => {
  await login(page);
  await page.goto('/backtesting');
  await page.getByLabel('Vé / kỳ').fill('5');
  await page.getByRole('button', { name: 'Chạy backtest' }).click();
  await expect(page.getByText(/Kết luận:/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/So sánh chiến lược với baseline/)).toBeVisible();
  await expect(page.getByText('Baseline').first()).toBeVisible();
});

test('AI Research: Monte Carlo & Bayes chạy và lưu lần chạy', async ({ page }) => {
  await login(page);
  await page.goto('/research');
  await page.getByRole('button', { name: 'Chạy' }).click();
  await expect(page.getByText(/Lần chạy #\d+/)).toBeVisible();
  await page.getByRole('tab', { name: 'Monte Carlo' }).click();
  await page.getByRole('button', { name: 'Mô phỏng' }).click();
  await expect(page.getByText('Kỳ có ≥1 vé trúng')).toBeVisible();
  await page.goto('/audit');
  await page.getByRole('tab', { name: 'Nhật ký kiểm toán' }).click();
  await expect(page.getByText('draws.import').first()).toBeVisible();
});

test('Quyết định hôm nay: hiển thị khuyến nghị, cập nhật Jackpot, ghi nhận', async ({ page }) => {
  await login(page);
  await page.goto('/today');
  await expect(page.getByRole('heading', { level: 2, name: /^(MUA|KHÔNG MUA)/ })).toBeVisible();
  await expect(page.getByText('Giá trị Jackpot hiện tại')).toBeVisible();
  await page.getByLabel(/Jackpot 1 \(tối thiểu/).fill('120000000000');
  await page.getByRole('button', { name: 'Lưu Power 6/55' }).click();
  await expect(page.getByText('Đã cập nhật giá trị Jackpot')).toBeVisible();
  await page.getByRole('button', { name: 'Ghi nhận quyết định' }).click();
  await expect(page.getByText(/Đã ghi nhận quyết định/)).toBeVisible();
  // Kỳ Chia giải Độc đắc: nhập số người trúng kỳ tham chiếu ⇒ hiển thị kỳ vọng ước tính / thận trọng
  await expect(page.getByRole('heading', { name: 'Kỳ Chia giải Độc đắc — Lotto 5/35' })).toBeVisible();
  await page.getByLabel('Độc đắc sẽ chia (tỷ)').fill('16,9');
  await page.getByLabel('Giải Nhì').fill('24');
  await page.getByLabel('Giải Ba').fill('490');
  await page.getByLabel('Giải Tư').fill('765');
  await page.getByLabel('Giải Năm').fill('11900');
  await page.getByRole('button', { name: 'Lưu kỳ chia giải' }).click();
  await expect(page.getByText('Đã lưu kỳ Chia giải Độc đắc')).toBeVisible();
  await expect(page.getByText('Kỳ vọng / vé (thận trọng)')).toBeVisible();
  await expect(page.getByText('Còn có lợi khi số vé dưới')).toBeVisible();
  const gen = page.getByRole('button', { name: /^Sinh \d+ bộ số/ });
  if (await gen.isVisible()) {
    await gen.click();
    await expect(page.getByRole('button', { name: 'Lưu danh mục' })).toBeVisible();
  }
});

test('Bingo18: bảng cược, mô phỏng phiên chơi, kế hoạch hôm nay', async ({ page }) => {
  await login(page);
  await page.goto('/bingo18');
  await expect(page.getByRole('heading', { level: 2, name: /^(TỐI ĐA|KHÔNG CHƠI)/ })).toBeVisible();
  await expect(page.getByText('Mỗi 10.000đ trả lại bao nhiêu?')).toBeVisible();
  await page.getByRole('tab', { name: 'Mô hình dự báo' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /CHƯA ĐỦ DỮ LIỆU|KHÔNG MÔ HÌNH|CÓ MÔ HÌNH/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Bảng cược & xác suất' }).click();
  await expect(page.getByText('Hoàn trả cao nhất')).toBeVisible();
  await expect(page.getByRole('cell', { name: '56,94%' }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Mô phỏng phiên chơi' }).click();
  await page.getByRole('button', { name: 'Mô phỏng' }).click();
  await expect(page.getByText('Khả năng phiên có lãi')).toBeVisible();
  await page.getByRole('tab', { name: 'Kết quả' }).click();
  await expect(page.getByText('Chưa có kết quả').or(page.getByText(/^#\d+/).first())).toBeVisible();
});

test('Xổ số kiến thiết: 4 tab hiển thị, giá trị vé 3 miền', async ({ page }) => {
  await login(page);
  await page.goto('/xskt');
  await expect(page.getByRole('heading', { level: 1, name: 'Xổ số kiến thiết' })).toBeVisible();
  await page.getByRole('radio', { name: 'Miền Bắc' }).click();
  // Tiêu đề phán quyết (các thẻ khác cũng là h2 ⇒ lọc theo nội dung để tránh vi phạm strict mode)
  await page.getByRole('tab', { name: 'Kiểm định' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /^(KẾT QUẢ KHỚP NGẪU NHIÊN|CÓ ĐỘ LỆCH THỐNG KÊ|CHƯA ĐỦ DỮ LIỆU)/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Mô hình dự báo' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /^(KHÔNG MÔ HÌNH NÀO|CÓ MÔ HÌNH VƯỢT|CHƯA ĐỦ DỮ LIỆU)/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Giá trị vé' }).click();
  await expect(page.getByText('Mỗi 10.000đ nhận lại trung bình bao nhiêu?')).toBeVisible();
  await expect(page.getByText('Cơ cấu giải — Miền Nam')).toBeVisible();
});

test('Danh mục: nhập vé tay (bắt buộc giờ quay với Lotto) rồi sửa giờ quay', async ({ page }) => {
  await login(page);
  await page.goto('/portfolio');
  await page.getByRole('tab', { name: 'Nhập vé tay' }).click();
  await page.getByLabel(/Vé, mỗi dòng một vé/).fill('02 05 08 23 26 | 08\n06 10 26 29 35 | 05');
  await expect(page.getByText('Xem trước:')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lưu vé đã nhập' })).toBeDisabled();
  await page.getByLabel(/^Giờ quay/).selectOption('21:00');
  await page.getByRole('button', { name: 'Lưu vé đã nhập' }).click();
  await expect(page.getByText(/Đã lưu danh mục #\d+/)).toBeVisible();
  await page.getByRole('button', { name: 'Chi tiết' }).first().click();
  await page.getByRole('button', { name: 'Sửa' }).click();
  await page.getByLabel(/^Giờ quay/).selectOption('13:00');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Đã lưu thay đổi danh mục')).toBeVisible();
});

test('Bingo18: chiến thuật kiểm soát lỗ (không có chiến thuật thắng chắc)', async ({ page }) => {
  await login(page);
  await page.goto('/bingo18');
  await page.getByRole('tab', { name: 'Chiến thuật kiểm soát lỗ' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'KHÔNG CÓ CHIẾN THUẬT NÀO BẢO ĐẢM KHÔNG LỖ' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Gấp thếp (Martingale)')).toBeVisible();
  await expect(page.getByText('Điều bảo đảm được khi chơi Bingo18')).toBeVisible();
});
