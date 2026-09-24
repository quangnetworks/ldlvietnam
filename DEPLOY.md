# Deploy LDL Workspace lên Cloudflare

Ứng dụng chạy trên **Cloudflare Workers**:

| Thành phần | Dịch vụ Cloudflare |
|---|---|
| API (Hono) | Workers |
| Cơ sở dữ liệu | D1 (SQLite) — `ldl-workspace-db` |
| Tệp đính kèm | R2 — `ldl-workspace-files` |
| Giao diện React | Workers Static Assets |

Mọi thứ (tạo D1, R2, chạy migration, tạo dữ liệu mẫu lần đầu, deploy) được tự động hoá bởi
GitHub Actions (`.github/workflows/deploy-cloudflare.yml` → `server/scripts/cf-setup.sh`).

## Bước 1 — Chuẩn bị tài khoản Cloudflare (làm 1 lần)

1. Đăng ký / đăng nhập https://dash.cloudflare.com
2. **Bật R2**: menu trái → *R2 Object Storage* → *Enable R2* (gói miễn phí 10 GB, Cloudflare có thể yêu cầu thêm phương thức thanh toán nhưng không tính phí trong hạn mức).
3. Lấy **Account ID**: trang *Workers & Pages* → cột phải *Account ID* → Copy.
4. Tạo **API Token**: *My Profile* → *API Tokens* → *Create Token* → mẫu **Edit Cloudflare Workers** → *Use template*,
   rồi bấm *+ Add more* để thêm 2 quyền:
   - `Account` · `D1` · `Edit`
   - `Account` · `Workers R2 Storage` · `Edit`

   → *Continue to summary* → *Create Token* → Copy token (chỉ hiện 1 lần).

## Bước 2 — Thêm secrets vào GitHub (làm 1 lần)

Repo `quangnetworks/ldlvietnam` → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*:

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token vừa tạo |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID |

## Bước 3 — Deploy

Tab *Actions* → **Deploy to Cloudflare** → *Run workflow*. Từ đó mỗi lần push lên nhánh `main`
(hoặc nhánh hiện tại) sẽ tự deploy lại. Dữ liệu D1/R2 được giữ nguyên giữa các lần deploy.

Khi xong, địa chỉ ứng dụng hiện trong log bước *Provision D1/R2 và deploy*, dạng:
`https://ldl-workspace.<tên-tài-khoản>.workers.dev`

Đăng nhập lần đầu: **admin / 123456** — hãy **đổi mật khẩu ngay** (menu tài khoản → Đổi mật khẩu),
rồi vào *Quản trị* để tạo tài khoản cho nhân viên và khoá / xoá các tài khoản mẫu.

## Tuỳ chọn

- **Tên miền riêng** (vd. `work.ldlvietnam.vn`): Workers & Pages → `ldl-workspace` → *Settings* → *Domains & Routes* → *Add Custom Domain* (tên miền phải quản lý DNS trên Cloudflare).
- **Bắt đầu với dữ liệu trống** thay vì dữ liệu mẫu: sau lần deploy đầu, vào Quản trị xoá/khoá dữ liệu mẫu, hoặc chạy
  `npx wrangler d1 execute DB --remote --command "DELETE FROM tasks; DELETE FROM documents; DELETE FROM projects;"` trong thư mục `server`.
- **Gói trả phí Workers ($5/tháng)** được khuyến nghị khi dùng thật: gói miễn phí giới hạn 100.000 request/ngày,
  10 ms CPU và 50 truy vấn D1 cho mỗi request — đủ cho nhóm nhỏ nhưng có thể chạm giới hạn khi thao tác hàng loạt nhiều bản ghi.
- **Deploy thủ công từ máy tính** (Node 22): `cd server && npm ci && npx wrangler login && ./scripts/cf-setup.sh`

## Chạy thử môi trường Cloudflare trên máy

```bash
cd server
npx wrangler d1 migrations apply DB --local
node src/seed.js --sql > /tmp/seed.sql && npx wrangler d1 execute DB --local --file /tmp/seed.sql
npm run cf:dev        # http://localhost:8787
```
