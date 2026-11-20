# Chạy QUANTUM FULL trên máy cá nhân

Chạy toàn bộ ứng dụng (giao diện React + Worker API + D1/SQLite) trên máy của bạn bằng runtime Workers cục bộ (workerd/Miniflare). Không cần tài khoản Cloudflare và không cần mạng (trừ lúc cài đặt và khi đồng bộ dữ liệu).

## Yêu cầu
- **Node.js 22 trở lên** — https://nodejs.org (Windows: bản LTS `.msi`).
- **Git** — https://git-scm.com.
- Windows 10/11 x64, macOS 12 trở lên, hoặc Linux x64/arm64 (Windows ARM chưa được runtime Workers cục bộ hỗ trợ).

## Cài đặt nhanh trên Windows (khuyến nghị)
Mở **PowerShell** (không cần quyền Administrator) và dán:
```powershell
irm https://raw.githubusercontent.com/quangnetworks/ldlvietnam/claude/charming-heisenberg-xtzan2/quantum-full/scripts/windows/install.ps1 -OutFile "$env:TEMP\quantum-install.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\quantum-install.ps1"
```
Script sẽ:
1. Kiểm tra/cài **Git** và **Node.js LTS** (qua winget) nếu thiếu.
2. Tải dự án vào `D:\OneDrive\10 Claude\Project Cloudflare\Quantum` (đổi bằng `-Target "…"`).
3. Đặt **database ngoài OneDrive** tại `%LOCALAPPDATA%\QuantumFull\state` (tránh hỏng file SQLite khi OneDrive đồng bộ).
4. Cài thư viện, tạo database, tạo `Quantum Full.cmd`, `Cap nhat Quantum.cmd` và shortcut **Quantum Full** trên Desktop, rồi mở ứng dụng.

**Các lần sau:** bấm đúp **Quantum Full** trên Desktop → trình duyệt mở http://localhost:5190. Khi mở app, dữ liệu tự đồng bộ nếu lần cuối đã quá 60 phút.
**Cập nhật phiên bản:** chạy `Cap nhat Quantum.cmd` trong thư mục Quantum.

## Cài đặt thủ công (một lần)
```bash
git clone https://github.com/quangnetworks/ldlvietnam.git
cd ldlvietnam/quantum-full
npm install
npm run setup:local
```
`setup:local` tạo `.dev.vars` (bật đăng nhập cục bộ, chỉ trên máy này) và tạo database D1 cục bộ.

## Chạy
```bash
npm run dev
```
Mở **http://localhost:5190**. Ở chế độ cục bộ bạn tự động có quyền Quản trị, không cần token.

## Tải dữ liệu thật lần đầu
Vào **Data Center → Đồng bộ tự động → Đồng bộ ngay**:
- Lotto 5/35 và Power 6/55 được tải đầy đủ ngay.
- Bingo18 có khoảng 100.000 kỳ, mỗi lần bấm tải thêm khoảng 3.000 kỳ (bấm nhiều lần hoặc dùng dần).
Sau đó đối chiếu và **Xác minh cả lần nhập**.

> Ở chế độ cục bộ không có Cron: ứng dụng tự đồng bộ khi được mở (nếu lần cuối > 60 phút), hoặc bấm “Đồng bộ ngay”.

## Dữ liệu được lưu ở đâu
Mặc định `quantum-full/.wrangler/state/`; nếu có `quantum.local.json` (`{"stateDir": "…"}`, bộ cài Windows tự tạo) thì lưu tại `stateDir`. Đây là file SQLite cục bộ. Sao lưu bằng cách copy thư mục này. Dữ liệu cục bộ tách biệt hoàn toàn với bản production tại quantum.vanquang.xyz.

## Cập nhật phiên bản mới
```bash
git pull
npm install
npx wrangler d1 migrations apply quantum-full-db --local
npm run dev
```

## Lệnh khác
| Lệnh | Mô tả |
| --- | --- |
| `npm test` | Chạy 132 bài kiểm thử |
| `npm run build` | Build bản production |
| `npm run start:local` | Như `npm run dev` nhưng chỉ nghe trên 127.0.0.1 |

## Sự cố thường gặp
- **`EADDRINUSE` cổng 5190**: một ứng dụng khác đang dùng cổng — đóng nó hoặc sửa `server.port` trong `vite.config.ts`.
- **Windows báo lỗi quyền khi `npm install`**: chạy terminal bằng tài khoản thường (không cần Administrator), đảm bảo thư mục không nằm trong OneDrive đang đồng bộ.
- **Trang báo “Cần đăng nhập”**: kiểm tra `.dev.vars` có `ALLOW_DEV_AUTH=true` và `APP_ENV=development`, rồi chạy lại `npm run dev`.
