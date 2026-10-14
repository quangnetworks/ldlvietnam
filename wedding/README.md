# H&M Wedding Invitation Studio — *The Art of Forever*

Website thiệp cưới cá nhân hoá cho **Trần Minh Huy & Tiểu Bảo Muội**. Dự án độc lập, không phụ thuộc LDL Workspace ở thư mục gốc.

**Trạng thái: Giai đoạn 1 — UI/UX.** Chưa có backend, chưa lưu trữ, chưa xử lý Excel hay xuất ảnh thật.

## Chạy

```bash
cd wedding
npm install
npm run dev        # http://localhost:5180
npm run build      # kiểm tra kiểu + build production
```

## Màn hình

| Đường dẫn | Màn hình |
|---|---|
| `/` | Wedding Landing Page |
| `/xem-truoc` | Invitation Preview (thiệp tĩnh / tương tác, chọn tên khách) |
| `/thiep?khach=HM-0001` | Thiệp cho người nhận — Chế độ A (phong bì tương tác) |
| `/thiep?khach=HM-0001&che-do=tinh` | Thiệp cho người nhận — Chế độ B (thiệp tĩnh 9:16) |
| `/studio` | Dashboard tổng quan |
| `/studio/thiet-ke` | Invitation Designer |
| `/studio/khach-moi` | Guest Management |
| `/studio/nhap-excel` | Nhập Excel (giao diện các bước) |
| `/studio/xuat-thiep` | Bulk Export (mô phỏng trạng thái) |
| `/studio/cai-dat` | Hồ sơ cưới, đối chiếu dữ liệu, lưu trữ |

## Dữ liệu

- `src/data/wedding.ts` — **nguồn dữ liệu chuẩn** (chép từ thiệp tham chiếu) và danh sách điểm cần xác nhận.
- `src/data/demo.ts` — khách mời và chỉ số **minh hoạ**.
- `src/data/design.ts` — cấu hình mẫu thiệp (bảng màu, thành phần, lời mời).

## Thiết kế

- Màu: Burgundy, Ivory, Champagne Gold, Warm Beige, Espresso, Soft Rose (`src/styles/index.css`).
- Font (tự host qua @fontsource, đủ tiếng Việt, giấy phép SIL OFL): Cormorant Garamond (serif), Be Vietnam Pro (sans), Great Vibes (thư pháp).
- Thiệp tĩnh dựng ở 540 × 960 và thu phóng; xuất ở hệ số 2 → 1080 × 1920.
