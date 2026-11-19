# Hướng dẫn triển khai Cloudflare

> Không deploy production khi chưa có sự đồng ý của chủ dự án. Các bước dưới đây do chủ dự án thực hiện.

## Yêu cầu
- Node.js ≥ 22, tài khoản Cloudflare có zone `vanquang.xyz`, quyền Workers/D1/Access.

## 1. Cài đặt
```bash
cd quantum-full
npm install
```

## 2. Đăng nhập Wrangler
```bash
npx wrangler login
```

## 3. Tạo D1
```bash
npx wrangler d1 create quantum-full-db
```
`wrangler.jsonc` **không** chứa `database_id`. Wrangler 4 tự liên kết/cấp phát D1 theo `database_name` khi deploy.
Nếu phiên bản Wrangler của bạn yêu cầu `database_id`, thêm id vào bản sao cục bộ (`wrangler.local.jsonc`, đã gitignore) hoặc đặt trong pipeline CI — không commit id vào repo.

## 4. Migration cục bộ
```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

## 5. Migration production
```bash
npm run db:migrate:remote
```
Migration `0002` chỉ seed cấu hình game, nguồn dữ liệu, phiên bản mô hình, thiết lập — không có kết quả quay.

## 6. Build
```bash
npm run build          # typecheck 4 project + vite build (client + worker)
npm test               # nên chạy trước khi deploy
```

## 7. Secrets & Deploy Worker
```bash
npx wrangler secret put ADMIN_TOKEN     # chuỗi ngẫu nhiên ≥ 32 ký tự (vd: openssl rand -hex 32)
npx wrangler secret put VIEWER_TOKEN    # tuỳ chọn
npx wrangler deploy --dry-run           # kiểm tra bindings
npx wrangler deploy                     # dùng cấu hình build tại dist/quantum_full/wrangler.json
```

## 8. Custom domain
`wrangler.jsonc` khai báo `routes: [{ pattern: "quantum.vanquang.xyz", custom_domain: true }]` — Wrangler tạo DNS & chứng chỉ khi deploy. Kiểm tra tại Workers & Pages → quantum-full → Settings → Domains & Routes. `workers_dev` tắt để chỉ có một điểm truy cập (đặt sau Access).

## 9. Cloudflare Access
1. Zero Trust → Access → Applications → **Add application → Self-hosted**.
2. Application domain: `quantum.vanquang.xyz` (toàn bộ đường dẫn).
3. Policy **Allow** cho email của chủ dự án (và người được phép).
4. Sao chép **Application Audience (AUD) Tag** và team domain (`<team>.cloudflareaccess.com`).
5. Cập nhật `wrangler.jsonc`:
   ```jsonc
   "ACCESS_TEAM_DOMAIN": "<team>.cloudflareaccess.com",
   "ACCESS_AUD": "<aud-tag>",
   "ADMIN_EMAILS": "owner@example.com"
   ```
6. `npm run deploy` lại. Worker tự xác minh JWT (chữ ký, aud, iss, exp) — không tin header khi chưa cấu hình.
7. (Tuỳ chọn) Tạo Service Token / bypass cho `/api/v1/health` nếu cần giám sát bên ngoài.

## 10. Kiểm tra production
```bash
curl -s https://quantum.vanquang.xyz/api/v1/health          # qua Access: cần đăng nhập / service token
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" https://quantum.vanquang.xyz/api/v1/games
npx wrangler tail quantum-full --format pretty                 # log JSON có cấu trúc
```
Checklist: đăng nhập Access ⇒ thấy vai trò “Quản trị”; `/api/v1/games` không token ⇒ 401 khi gọi trực tiếp; nhập thử dữ liệu chính thức, xác minh; xác minh thể lệ tại Cài đặt.

## Giới hạn CPU
Các tác vụ nặng đã được chia nhỏ (backtest theo đoạn, giới hạn Monte Carlo/ML). Gói Workers Paid khuyến nghị cho ML/backtest lớn; có thể đặt `"limits": { "cpu_ms": 60000 }` trong `wrangler.jsonc` (chỉ gói trả phí).

## CI
`.github/workflows/quantum-full.yml` chạy typecheck, test, build trên mỗi push liên quan. Job deploy chỉ chạy khi kích hoạt thủ công (`workflow_dispatch` với `deploy=true`) và cần secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## Rollback
```bash
npx wrangler deployments list
npx wrangler rollback <deployment-id>
```
Migration D1 chỉ thêm; sao lưu trước khi đổi schema: `npx wrangler d1 export quantum-full-db --remote --output backup.sql`.
