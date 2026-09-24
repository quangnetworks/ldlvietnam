# Deploy LDL Workspace lên Cloudflare

Ứng dụng chạy trên **Cloudflare Workers** dưới dạng một Worker **hoàn toàn mới**, tách biệt với các Worker bạn đang có:

| Thành phần | Dịch vụ Cloudflare | Tên |
|---|---|---|
| API + giao diện | Workers (+ Static Assets) | `ldlvietnam-workspace` |
| Cơ sở dữ liệu | D1 (SQLite) | `ldlvietnam-workspace-db` |
| Tệp đính kèm | R2 | `ldlvietnam-workspace-files` |

Script `server/scripts/cf-setup.mjs` tự tạo D1, R2, chạy migration, tạo dữ liệu ban đầu, build giao diện và deploy.
Lần đầu, nếu một trong ba tên trên **đã tồn tại** trên tài khoản, script **dừng lại, không ghi đè** gì cả.

## Cách 1 — Deploy từ máy tính (dùng tài khoản wrangler đang đăng nhập)

Yêu cầu: **Node.js 22+**, **Git**, và **R2 đã được bật** trên tài khoản
(Dashboard → *R2 Object Storage* → *Enable*; nếu bạn chưa dùng R2 bao giờ).

```bash
git clone -b claude/charming-heisenberg-xtzan2 https://github.com/quangnetworks/ldlvietnam.git
cd ldlvietnam/server
npm ci
npx wrangler whoami          # kiểm tra đúng tài khoản Cloudflare đang dùng cho các Worker khác
node scripts/cf-setup.mjs    # tạo mới Worker + D1 + R2 và deploy
```

Chạy được trên Windows (PowerShell / CMD), macOS và Linux. Nếu `whoami` báo chưa đăng nhập, chạy `npx wrangler login`.
Nếu tài khoản có nhiều account, đặt `CLOUDFLARE_ACCOUNT_ID` trước khi chạy
(PowerShell: `$env:CLOUDFLARE_ACCOUNT_ID="..."`, bash: `export CLOUDFLARE_ACCOUNT_ID=...`).

Kết thúc, script in ra địa chỉ dạng `https://ldlvietnam-workspace.<tên-tài-khoản>.workers.dev`.

**Cập nhật code về sau** (giữ nguyên dữ liệu): `git pull && npm ci && node scripts/cf-setup.mjs --reuse`

## Cách 2 — Tự deploy bằng GitHub Actions

Workflow `.github/workflows/deploy-cloudflare.yml` chạy test rồi deploy (`cf-setup.mjs --reuse`) mỗi khi push,
khi repo có 2 secret `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

1. Tạo **API Token**: *My Profile* → *API Tokens* → *Create Token* → mẫu **Edit Cloudflare Workers** → *Use template*,
   bấm *+ Add more* thêm `Account · D1 · Edit` và `Account · Workers R2 Storage · Edit` → *Create Token*.
2. Repo → *Settings* → *Secrets and variables* → *Actions*: thêm `CLOUDFLARE_API_TOKEN` và `CLOUDFLARE_ACCOUNT_ID`.
3. Tab *Actions* → **Deploy to Cloudflare** → *Run workflow*.

## Sau khi deploy

Đăng nhập **admin / 123456** — **đổi mật khẩu ngay** (menu tài khoản → Đổi mật khẩu),
rồi vào *Quản trị* tạo tài khoản cho nhân viên và khoá các tài khoản mẫu.

## Tuỳ chọn

- **Tên miền riêng** (vd. `work.ldlvietnam.vn`): Workers & Pages → `ldlvietnam-workspace` → *Settings* → *Domains & Routes* → *Add Custom Domain* (tên miền phải quản lý DNS trên Cloudflare).
- **Bắt đầu với dữ liệu trống** thay vì dữ liệu mẫu: sau lần deploy đầu, vào Quản trị xoá/khoá dữ liệu mẫu, hoặc chạy
  `npx wrangler d1 execute DB --remote --command "DELETE FROM tasks; DELETE FROM documents; DELETE FROM projects;"` trong thư mục `server`.
- **Gói trả phí Workers ($5/tháng)** được khuyến nghị khi dùng thật: gói miễn phí giới hạn 100.000 request/ngày,
  10 ms CPU và 50 truy vấn D1 cho mỗi request — đủ cho nhóm nhỏ nhưng có thể chạm giới hạn khi thao tác hàng loạt nhiều bản ghi.
  Base Message cập nhật tin nhắn bằng polling (~6 giây/lần khi tab đang mở): 20 người mở chat suốt 8 giờ ≈ 100.000 request/ngày,
  nên nếu dùng chat nhiều hãy nâng lên gói trả phí.

## Chạy thử môi trường Cloudflare trên máy

```bash
cd server
npx wrangler d1 migrations apply DB --local
node src/seed.js --sql > /tmp/seed.sql && npx wrangler d1 execute DB --local --file /tmp/seed.sql
npm run cf:dev        # http://localhost:8787
```
