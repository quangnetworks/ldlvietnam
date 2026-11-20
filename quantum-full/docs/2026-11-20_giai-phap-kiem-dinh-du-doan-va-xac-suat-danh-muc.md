# Giải pháp: Kiểm định khả năng dự đoán & Xác suất chính xác của danh mục vé

Ngày: 2026-11-20 · Phạm vi: `quantum-full` (Lotto 5/35, Power 6/55)

## 1. Vấn đề

Người dùng muốn "dùng toán học cao cấp để tìm ra thuật toán quay số và gợi ý số mua". Ngày 20/11, kỳ 13:00 có kết quả
**10 21 24 30 32 | 08**. 4 vé được gợi ý chỉ có 1 vé trúng số đặc biệt (giải Khuyến khích 10.000đ), nên kỳ đó lỗ 30.000đ.

Hai câu hỏi cần trả lời bằng số liệu, không bằng cảm giác:

1. **Có quy luật nào trong kết quả quay để khai thác được không?** Nếu có thì "thuật toán quay số" đoán được.
2. **Với số tiền đã quyết định chi, nên chọn vé thế nào cho tốt nhất?** Câu hỏi này có lời giải toán học chính xác.

## 2. Kết quả kiểm định trên dữ liệu thật (1.018 kỳ Lotto 5/35, 29/06/2025 – 19/11/2026)

| Kiểm định | Thống kê | p |
|---|---|---|
| Phân bố đều 35 số chính (χ², 34 bậc tự do) | 50,5 | 0,034 |
| Phân bố đều 12 số đặc biệt (χ², 11 bậc tự do) | 2,0 | 0,998 |
| Đồng xuất hiện 595 cặp số (χ², 594 bậc tự do) | 653,7 | 0,045 |
| Số trùng với kỳ trước: trung bình 0,703, lý thuyết 0,714 (z) | −0,49 | 0,63 |
| Markov số đặc biệt, kỳ trước → kỳ sau (χ², 121 bậc tự do) | 129,1 | 0,29 |
| Phân bố tổng 5 số so với lý thuyết chính xác (χ², 8 bậc tự do) | 7,9 | 0,45 |

Khi làm nhiều kiểm định cùng lúc, cần hiệu chỉnh đa kiểm định (Benjamini–Hochberg). Sau hiệu chỉnh, không kiểm định
nào còn có ý nghĩa: hai giá trị p ≈ 0,03–0,045 là mức dao động ngẫu nhiên bình thường khi chạy 6 kiểm định.

Backtest walk-forward trên 918 kỳ: mỗi kỳ chỉ dùng dữ liệu trước kỳ đó, chuẩn lý thuyết là 0,714 số trùng/vé.

| Chiến lược | Số trùng TB/vé | z | p |
|---|---|---|---|
| Số "nóng" (ra nhiều nhất 50 kỳ) | 0,715 | 0,01 | 0,99 |
| Số "lạnh" (ra ít nhất 50 kỳ) | 0,712 | −0,08 | 0,94 |
| Lặp lại kỳ trước | 0,688 | −1,06 | 0,29 |
| Số "gan" (lâu chưa ra) | 0,730 | 0,64 | 0,52 |
| Số đặc biệt nóng: tỷ lệ trúng, lý thuyết 8,3% | 7,6% | −0,78 | 0,44 |
| Số đặc biệt lặp kỳ trước: tỷ lệ trúng, lý thuyết 8,3% | 9,4% | 1,13 | 0,26 |

**Kết luận:** dữ liệu khớp với giả thuyết "mỗi kỳ quay độc lập và đồng đều". Không chiến lược chọn số nào vượt
chọn ngẫu nhiên. Vì vậy **không thể suy ra thuật toán quay số để đoán số**. Hệ thống sẽ không quảng bá điều ngược lại.

## 3. Chỗ toán học thực sự giúp được

Với kỳ quay đồng đều, mọi vé có cùng giá trị kỳ vọng. Nhưng **cách phối hợp nhiều vé** làm thay đổi *hình dạng*
phân phối kết quả. Có thể tính **chính xác** điều này bằng cách liệt kê toàn bộ không gian kết quả:
C(35,5) × 12 = 3.895.584 kết quả cho Lotto 5/35.

- **Xác suất có ít nhất 1 vé trúng.** Mua *n* vé ngẫu nhiên độc lập: 1 − (1 − 9,6%)ⁿ. Mua *n* vé có số đặc biệt khác nhau
  và số chính ít trùng nhau: xác suất cao hơn với cùng chi phí.
  - Ví dụ 4 vé: số đặc biệt khác nhau cho chính xác 4/12 = 33,3% có vé trúng số đặc biệt, so với 29,4% khi chọn độc lập.
- **Giá trị kỳ vọng không đổi.** Tối ưu chỉ làm "trúng đều hơn" (ít kỳ trắng tay hơn), không làm tổng tiền thưởng
  kỳ vọng tăng. Hệ thống phải nói rõ điều này.
- **Chia giải Jackpot.** Bộ số ít người chọn không tăng xác suất trúng, nhưng tăng phần nhận được nếu trúng.
  Hệ thống đã có sẵn heuristic này.

## 4. Giải pháp triển khai

### 4.1 Engine `src/engine/predictability.ts` — "Phán quyết khả năng dự đoán"

`predictabilityAudit(rules, draws, { warmup, window })` gom một bộ kiểm định chạy tự động:

- **Kiểm định ngẫu nhiên:**
  - phân bố đều số chính;
  - phân bố đều số đặc biệt (game có nhóm số đặc biệt riêng);
  - đồng xuất hiện cặp số;
  - số trùng với kỳ trước, so với phân phối siêu bội chính xác;
  - phụ thuộc kỳ trước → kỳ sau của số đặc biệt;
  - phân bố tổng so với phân phối chính xác.
- **Backtest walk-forward các chiến lược phổ biến:** nóng, lạnh, lặp kỳ trước, gan; số đặc biệt nóng, số đặc biệt lặp kỳ trước.
  Mỗi chiến lược có kiểm định z so với kỳ vọng siêu bội.
- **Hiệu chỉnh Benjamini–Hochberg** cho toàn bộ giá trị p, ra giá trị q.
- **Phán quyết:**
  - `exploitable`: có chiến lược vượt chuẩn với q < 0,05;
  - `anomaly`: có kiểm định lệch với q < 0,05 nhưng không chiến lược nào khai thác được;
  - `random`: không có dấu hiệu nào.
- **Ngưỡng dữ liệu:** dưới 200 kỳ thì báo `insufficient`.

### 4.2 Engine `src/engine/portfolioOdds.ts` — xác suất chính xác của danh mục

`portfolioOdds(rules, tickets, jackpots)`:

- **Tính chính xác** khi C(N,K) ≤ 600.000 (Lotto 5/35). Liệt kê mọi tổ hợp số chính bằng bitmask, rồi tách theo số đặc biệt:
  mỗi tổ hợp tốn O(số vé) phép tính.
- **Mô phỏng Monte Carlo có seed** cho game lớn (Power 6/55: 29 triệu tổ hợp), giới hạn khối lượng như module Monte Carlo hiện có.
- **Kết quả trả về:**
  - P(ít nhất 1 vé trúng giải);
  - P(tiền thưởng ≥ chi phí);
  - tiền thưởng kỳ vọng và tỷ lệ hoàn vốn;
  - phân phối theo nhóm: 0đ, < chi phí, ≥ chi phí, ≥ 10 × chi phí;
  - so sánh với cùng số vé chọn ngẫu nhiên độc lập.

### 4.3 API (đều cần đăng nhập, không ghi dữ liệu)

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/v1/predictability?game=…&include_unverified=…&warmup=…&window=…` | Phán quyết + bảng kiểm định + backtest |
| POST | `/api/v1/portfolio/odds` | `{ game, tickets: [{main, special}] }`, tối đa 50 vé; trả xác suất chính xác của danh mục. Quyền admin (mọi POST đều yêu cầu admin), giống luồng sinh bộ số |

Không đổi schema DB, không có migration mới.

### 4.4 Giao diện

- **Trang mới "Kiểm định dự đoán"** (`/predictability`) gồm:
  - thẻ phán quyết;
  - bảng kiểm định có p, q;
  - bảng backtest chiến lược;
  - giải thích bằng tiếng Việt dễ hiểu.
- **Trang "Quyết định hôm nay"** có thêm thẻ tóm tắt phán quyết cho game đang được đề xuất, kèm liên kết sang trang chi tiết.
  Thẻ này dùng toàn bộ dữ liệu, kể cả kỳ chưa xác minh (vì dữ liệu đồng bộ tự động mặc định ở trạng thái đó), và ghi rõ điều này.
- **Kết quả sinh bộ số** (dùng chung cho trang Hôm nay, Sinh bộ số, Tối ưu danh mục) có thêm thẻ "Xác suất chính xác của danh mục":
  P(≥1 vé trúng) của danh mục so với chọn ngẫu nhiên, P(hoàn vốn) và phân phối tiền thưởng.

## 5. Tiêu chí chấp nhận

1. Danh mục 1 vé: P(trúng) và kỳ vọng tính chính xác phải khớp `anyPrizeProbability` / `expectedValue` hiện có (sai số < 1e-12).
2. Danh mục 12 vé Lotto 5/35 với 12 số đặc biệt khác nhau: P(≥1 vé trúng) = 1.
3. Dữ liệu mô phỏng đồng đều 600 kỳ: phán quyết khác `exploitable`.
   Dữ liệu cố tình lệch (một số luôn xuất hiện): phán quyết `exploitable` và chiến lược "nóng" có q < 0,05.
4. API trả 400 khi vé sai thể lệ, 401 khi chưa đăng nhập, 404 khi game không tồn tại.
5. `npm test` và `npm run typecheck` xanh; trang mới hiển thị đúng trên desktop và màn hình 375px, console sạch.

## 6. Ngoài phạm vi / rủi ro

- Không có tính năng nào khẳng định "đoán được số". Mọi màn hình đều nói rõ: tối ưu không tăng kỳ vọng.
- Với Cloudflare gói miễn phí (10 ms CPU), tính chính xác cho Lotto 5/35 (~324k tổ hợp × số vé) có thể vượt giới hạn.
  Chế độ cục bộ không bị ảnh hưởng; khi deploy lên Cloudflare nên dùng gói trả phí.
- **Triển khai:** đẩy nhánh, tạo PR vào `claude/charming-heisenberg-xtzan2`. Bản cục bộ cập nhật bằng `Cap nhat Quantum.cmd`.
  Không chạy `wrangler deploy` khi chưa được xác nhận (quy tắc dự án).

## 7. Kết quả triển khai (2026-11-20)

- Engine: `src/engine/predictability.ts`, `src/engine/portfolioOdds.ts`.
- API: `src/worker/routes/predictability.ts`.
- Giao diện:
  - trang `src/client/pages/Predictability.tsx`;
  - thẻ `src/client/components/PortfolioOdds.tsx`, gắn vào kết quả sinh bộ số;
  - thẻ tóm tắt trên trang Hôm nay.
- Kiểm thử: 147/147 test (thêm 12 test engine + 3 test API), typecheck xanh.
- Kiểm tra trình duyệt trên dữ liệu thật 1.018 kỳ: phán quyết **"Không có quy luật khai thác được"** (p nhỏ nhất 0,0076, q = 0,092).
- Kiểm tra màn hình 375px: không có cuộn ngang, console sạch.
- 4 vé ngày 20/11 tính chính xác: P(≥1 vé trúng) = 36,96%; nếu chọn ngẫu nhiên độc lập là 33,23%.
- E2E Playwright đã bổ sung kịch bản. Chưa chạy được trên máy này vì thiếu bản Chromium headless 1243 (`npx playwright install`).
  Đã kiểm thay bằng trình duyệt tích hợp trên D1 e2e riêng.
