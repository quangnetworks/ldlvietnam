# H&M Wedding Invitation Studio — *The Art of Forever*

Website thiệp cưới cá nhân hoá cho **Trần Minh Huy & Tiểu Bảo Muội**, chạy trên Worker Cloudflare riêng **`hm-wedding`** tại **https://temp.vanquang.xyz**.
Tách biệt hoàn toàn với LDL Workspace (Worker `ldlvietnam-workspace`) — chỉ ở chung repository.

## Hai cách gửi thiệp cho từng khách

1. **Link riêng** — mỗi khách có link dạng `https://temp.vanquang.xyz/t/<mã-bí-mật>`. Mở ra là phong bì có tên khách, rồi thiệp tương tác; khách cũng xem/lưu được ảnh thiệp. Studio ghi nhận đã gửi / đã mở / số lần mở. Link không chứa tên khách; dán vào Zalo/Messenger hiện ảnh xem trước và tiêu đề “Thiệp mời — <tên khách>”.
2. **Ảnh PNG riêng** — Studio tạo ảnh 1080 × 1920 cho từng khách ngay trên trình duyệt (font nhúng sẵn, kiểm tra tên trước khi chụp), tải từng ảnh, chia sẻ thẳng (trên điện thoại) hoặc tải ZIP. Tên file chứa mã khách: `HM-0001_anh-nguyen-van-a.png`.

## Đường dẫn

| Đường dẫn | Nội dung |
|---|---|
| `/` | Landing page |
| `/xem-truoc` | Xem trước thiệp (khách mẫu) |
| `/t/<mã>` | Thiệp riêng của từng khách |
| `/studio` | Studio (cần mật khẩu): tổng quan, thiết kế, khách mời, nhập Excel, gửi & xuất thiệp, cài đặt |

## Phát triển

```bash
cd wedding
npm install
npm run dev:worker   # build + wrangler dev (Worker + Durable Object) → http://127.0.0.1:8787
npm run dev          # (tuỳ chọn) Vite hot reload ở :5180, proxy /api sang :8787
npm run build        # kiểm tra kiểu (app + worker) và build
```

## Kiến trúc

- `src/` — React + TypeScript + Tailwind. `src/data/wedding.ts` là nguồn dữ liệu chuẩn theo thiệp tham chiếu.
- `worker/` — Worker: API `/api/*`, trang `/t/<mã>` (gắn thẻ OG theo tên khách), phục vụ file tĩnh.
- Lưu trữ: một **Durable Object SQLite** (`WeddingStore`) chứa khách mời, link, lượt mở, thiết kế, mật khẩu. Không cần tạo D1/KV.
- Ảnh PNG: `html-to-image` trên trình duyệt; ZIP: `fflate`. Excel: `read-excel-file` / `write-excel-file`.

Deploy: xem [DEPLOY.md](DEPLOY.md).
