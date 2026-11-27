# Thiết kế lại giao diện QUANTUM FULL bằng Hallmark

Ngày: 2026-11-27 · Skill: Hallmark v2.0.0 (Nutlope/hallmark, commit `04977e1`, MIT) · Lệnh: `redesign` toàn phần, phạm vi app.

## Picks

- **Redesign** · toàn phần · 15 màn hình làm việc (dashboard/công cụ), giữ nguyên khung điều hướng.
- **Before** · 19 FAIL · 3 REFLEX · 6 WARN. Lỗi chính:
  - bảng màu mặc định của Tailwind (xanh `#3b82f6` trên nền navy);
  - màu viết thẳng vào code;
  - nhãn viết hoa, giãn chữ ("LOTTERY INTELLIGENCE");
  - chuỗi thông tin nối bằng "·", dấu gạch dài trong câu, mũi tên dính chữ;
  - nhãn dùng font mono, nút không có trạng thái khi nhấn.
- **Keeps** · mọi liên kết, handler, route, API, test hook · toàn bộ nội dung và số liệu · nền tối.
- **Files** · sửa `styles.css`, `index.html`, `components/ui.tsx`, `Layout.tsx`, `Chart.tsx`, `charts.tsx`, `GenerationResult.tsx`, `PortfolioOdds.tsx`, `SplitDrawCard.tsx` và các trang · tạo `tokens.css`, `base.css` · xoá: không.
- **Theme** · Console (chia 3/3), biến thể graphite:
  - nền graphite 3 bậc, khung viền mảnh 1px, không đổ bóng, không gradient;
  - hổ phách = người dùng (nút chính, mục đang chọn, cảnh báo);
  - xanh lạnh = số đo (số quay, thời điểm, mã);
  - xanh lá/đỏ chỉ dùng cho trạng thái.
- **Font** · đổi khỏi font gốc của Console vì Host Grotesk và Atkinson Hyperlegible Mono **không có bộ dấu tiếng Việt**:
  - **Be Vietnam Pro** 400/500 cho chữ đọc;
  - **IBM Plex Mono** cho mọi con số (lớp `measured`, số 0 có gạch chéo).
- **Screen** · mỗi màn hình mở đầu bằng một bản ghi đặt cỡ lớn (component `RecordLead`): phán quyết và lý do ở bên trái, con số chính bên phải, cắt từ cùng một mặt phẳng.
  - Hôm nay: tỷ lệ hoàn lại kỳ vọng mỗi vé.
  - Kiểm định dự đoán: số kỳ đã kiểm định.
  - XSKT: số kỳ đã phân tích hoặc đã chấm.
  - Bingo18: ngân sách khả dụng.
- **Signature** · phán quyết "Quyết định hôm nay" đặt thành một số đo: tỷ lệ hoàn lại kỳ vọng, chi phí, lãi hoặc lỗ kỳ vọng, ngày và giờ quay.

## Kết quả

| | Trước | Sau |
|---|---|---|
| sloplint (phạm vi app, 28 file) | 19 FAIL · 3 REFLEX · 6 WARN | 0 · 0 · 0 |
| Giữ nguyên | | liên kết 9/9 · handler 154/154 |
| Test / typecheck | 175 | 175 xanh · typecheck xanh |
| 375px (14 route) | | không tràn ngang, console sạch |

**Thay đổi chữ** (cổng copy 19, 63):
- Thay dấu "—" và "–" trong câu bằng dấu phẩy, dấu hai chấm hoặc "đến". Áp dụng cả cho chữ do server sinh, ví dụ tiêu đề:
  - `MUA 10 VÉ LOTTO 5/35 — KỲ 13:00` → `MUA 10 VÉ LOTTO 5/35, KỲ 13:00`;
  - `KHÔNG MUA — …` → `KHÔNG MUA: …`.
- Tách các chuỗi nối bằng "·" thành danh sách nhãn và giá trị.
- "Xem chi tiết kiểm định →" → "Xem chi tiết kiểm định".

**Kỹ thuật:**
- Một khối token duy nhất là `@theme` trong `styles.css`.
- Biểu đồ ECharts đọc màu token lúc chạy rồi đổi sang sRGB.
- Các class của theme nằm trong `@layer components` để class utility vẫn ghi đè được.

## Chưa làm / ghi chú

- Tầng render của sloplint (chụp ảnh tự động, `compare.html`) cần puppeteer, máy chưa cài.
  Đã thay bằng ảnh chụp từ trình duyệt tích hợp, ở desktop 1440px và điện thoại 375px.
- Bước "đánh giá hoàn thiện" chạy bởi một agent riêng (`gates.md` § 6) chưa chạy, vì chỉ dùng agent riêng khi chủ dự án yêu cầu.
- Các màn hình phụ (Data Center, Thống kê, AI Research, Backtesting, Kiểm soát vốn, Kiểm toán, Cài đặt) chỉ áp hệ thống mới qua component dùng chung.
  Bố cục của chúng giữ nguyên.

## Triển khai

- Nhánh `quantum/hallmark` đã qua CI (test, E2E, deploy) ở commit `07940f7`.
- Khi merge vào `claude/charming-heisenberg-xtzan2`, git tự gộp với PR #8 (mô hình dự báo Bingo18). Bản gộp đạt typecheck, 178 test và sloplint sạch (0/0/0).
- Deploy lại từ bản gộp, để production có cả giao diện mới lẫn PR #8.
