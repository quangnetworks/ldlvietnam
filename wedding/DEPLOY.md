# Deploy H&M Wedding lên Cloudflare

| Thành phần | Giá trị |
|---|---|
| Worker | `hm-wedding` (mới, riêng) |
| Tên miền | `temp.vanquang.xyz` (Custom Domain của Worker) |
| Dữ liệu | Durable Object SQLite `WeddingStore` — tự tạo khi deploy |

## Tự động (GitHub Actions)

Workflow `.github/workflows/deploy-wedding.yml` chạy khi có thay đổi trong `wedding/` (nhánh `main` hoặc `claude/charming-heisenberg-xtzan2`), hoặc bấm *Run workflow*.
Dùng lại 2 secrets sẵn có của repo: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

Điều kiện để gắn `temp.vanquang.xyz`:
- Zone `vanquang.xyz` nằm **cùng tài khoản Cloudflare** với `CLOUDFLARE_ACCOUNT_ID`.
- API token có quyền **Zone → Workers Routes → Edit** và **Zone → DNS → Edit** cho zone đó (mẫu “Edit Cloudflare Workers” + thêm DNS Edit).
- Không có bản ghi DNS `temp` trùng sẵn (nếu có, xoá trước).

Nếu thiếu một trong các điều kiện trên, workflow vẫn deploy Worker lên `hm-wedding.<tài-khoản>.workers.dev` và báo cảnh báo.

## Thủ công

```bash
cd wedding
npm ci
npx wrangler login
npm run deploy
```

## Mật khẩu Studio

Mật khẩu mặc định do chủ tiệc chọn; `wrangler.jsonc` chỉ chứa **bản băm PBKDF2** của nó. Có thể đổi trong **Studio → Cài đặt** (lưu trong Durable Object, đăng xuất mọi thiết bị khác). Khi `ADMIN_PASSWORD_HASH` trong cấu hình thay đổi và được deploy, mật khẩu mặc định mới có hiệu lực trở lại và thay cho mật khẩu đã đổi trong Studio. Đăng nhập sai 8 lần sẽ bị khoá 15 phút.

## Sao lưu

Dữ liệu không tự sao lưu. Tải bản JSON tại **Studio → Cài đặt → Tải bản sao lưu**, hoặc **Studio → Khách mời → Xuất danh sách** (Excel, kèm link).
