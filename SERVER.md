# Chạy LDL Workspace trên máy chủ của công ty

Bản này chạy cùng mã nguồn với bản Cloudflare. Điểm khác là dữ liệu nằm ngay trên máy chủ công ty:

- **CSDL SQLite**: tệp `data/app.db`.
- **Tệp đính kèm**: thư mục `data/uploads/`.

Sao lưu thư mục `data/` là giữ được toàn bộ dữ liệu.

Có 3 cách cài:

- **Docker**: khuyên dùng trên Linux.
- **Gói Node.js**: Linux hoặc macOS, không cần Docker.
- **Gói Windows**: có sẵn `node.exe`, dùng cho Windows Server 2012 R2 trở lên.

| Yêu cầu tối thiểu (300–500 nhân sự) | |
|---|---|
| CPU / RAM | 2 nhân / 2 GB |
| Ổ đĩa | 20 GB trở lên, tuỳ dung lượng tệp đính kèm |
| Phần mềm | Docker 24 trở lên **hoặc** Node.js 22.5 trở lên |
| Mạng | Mở cổng `4000` (hoặc cổng tự đặt) trong mạng nội bộ |

---

## Cách 1 — Docker (khuyên dùng)

```bash
# 1. Lấy mã nguồn: clone repo, hoặc giải nén gói ldl-workspace-*.tar.gz
cd ldl-workspace

# 2. Cấu hình
cp .env.example .env
nano .env        # đặt ADMIN_PASSWORD; DEMO_DATA=0 để dùng thật, =1 để dùng thử với dữ liệu mẫu

# 3. Build và chạy (tự khởi động lại khi máy chủ bật lại)
docker compose up -d --build

# 4. Xem log / tài khoản quản trị được tạo
docker compose logs -f
```

Mở `http://<IP-máy-chủ>:4000`, ví dụ `http://192.168.1.10:4000`, rồi đăng nhập bằng tài khoản `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

Các lệnh thường dùng:

| Việc | Lệnh |
|---|---|
| Dừng / chạy lại | `docker compose stop` / `docker compose up -d` |
| Cập nhật phiên bản mới | `git pull` (hoặc giải nén gói mới, **giữ nguyên `data/` và `.env`**) rồi `docker compose up -d --build` |
| Sao lưu ngay | `docker compose exec ldl-workspace npm run -s backup` |
| Kiểm tra tình trạng | `docker compose ps`: cột STATUS phải là `healthy` |

Khi chạy bản mới, các thay đổi CSDL (migration) tự áp dụng, dữ liệu cũ được giữ nguyên.

## Cách 2 — Node.js, không Docker

1. Trên máy có Internet, tạo gói cài đặt (cần Node.js 22.5 trở lên):

   ```bash
   npm run package     # → release/ldl-workspace-<phiên bản>-<ngày>.tar.gz
   ```

2. Chép tệp `.tar.gz` lên máy chủ, giải nén, rồi chạy:

   ```bash
   tar -xzf ldl-workspace-*.tar.gz && cd ldl-workspace
   cp .env.example .env && nano .env
   ./start.sh              # Windows: start.cmd
   ```

   Gói đã có sẵn thư viện, nên máy chủ không cần Internet.

3. Chạy như dịch vụ (Linux, systemd), để ứng dụng tự khởi động cùng máy:

   ```bash
   sudo useradd -r -s /usr/sbin/nologin ldl
   sudo mv ldl-workspace /srv/ && sudo chown -R ldl:ldl /srv/ldl-workspace
   sudo cp /srv/ldl-workspace/ldl-workspace.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now ldl-workspace
   journalctl -u ldl-workspace -f
   ```


## Cách 3 — Windows Server (2012 R2 / 2016 / 2019 / 2022), chạy thẳng không cần cài gì

Gói `ldl-workspace-…-windows.zip` có sẵn `node.exe` (Node.js 22, bản 64-bit), khoảng 35 MB. Máy chủ không cần cài Node.js, cũng không cần Internet.

Gói nhẹ `…-windows-lite.zip` (khoảng 2 MB) không kèm `node.exe`. Khi dùng gói này, tải `node.exe` theo đường dẫn trong `node\TAI-NODE.txt` (https://nodejs.org/dist/v22.23.3/win-x64/node.exe) rồi đặt vào thư mục `node\` (thành `node\node.exe`).

1. **Giải nén** gói vào một thư mục cố định, ví dụ `C:\ldl-workspace`:
   - Chuột phải tệp zip → Extract All.
   - Nên đặt thư mục ở ổ có nhiều dung lượng, vì dữ liệu nằm trong `C:\ldl-workspace\data`.
2. **Cấu hình**:
   - Chép `.env.example` thành `.env`.
   - Mở `.env` bằng Notepad, đặt `ADMIN_PASSWORD` (và `PORT` nếu cổng 4000 đã có chương trình khác dùng).
   - Nếu `COMPANY_NAME` có tiếng Việt có dấu, lưu tệp với Encoding **UTF-8**.
3. **Chạy thử**: nhấp đúp `start.cmd`, rồi mở `http://localhost:4000` trên chính máy chủ.
   - Đóng cửa sổ đen là dừng chương trình.
4. **Chạy ngầm cùng Windows**: chuột phải `install-service.cmd` → **Run as administrator**. Tệp này sẽ:
   - đăng ký Task Scheduler "LDL Workspace": chạy khi khởi động máy, tài khoản SYSTEM, tự chạy lại nếu bị dừng;
   - đăng ký "LDL Workspace - Sao luu": sao lưu 01:30 mỗi đêm vào `data\backups`;
   - mở cổng trên Windows Firewall;
   - chạy ngay và kiểm tra `http://127.0.0.1:<cổng>`.
5. Máy khác trong công ty mở `http://<IP-máy-chủ>:4000`. Xem IP bằng lệnh `ipconfig`.

| Việc | Cách làm |
|---|---|
| Xem nhật ký | `C:\ldl-workspace\data\server.log` |
| Dừng / chạy lại | Task Scheduler → "LDL Workspace" → End / Run |
| Sao lưu ngay | nhấp đúp `backup.cmd` |
| Cập nhật bản mới | `uninstall-service.cmd` (Run as administrator) → giải nén bản mới **đè lên** thư mục cũ, giữ nguyên `data\` và `.env` → `install-service.cmd` |
| Gỡ | `uninstall-service.cmd` (dữ liệu trong `data\` được giữ nguyên) |

**Lưu ý về Windows Server 2012**:

- Node.js 22 chính thức hỗ trợ từ Windows 10 / Server 2016. Các tệp `.cmd` đã đặt `NODE_SKIP_PLATFORM_CHECK=1` để Node.js vẫn chạy được trên 2012 / 2012 R2.
- Đây là cấu hình Node.js không cam kết hỗ trợ. Bản **2012 R2 đã cập nhật Windows Update đầy đủ** thường chạy ổn. Bản 2012 đời đầu (không R2) có thể không chạy được.
- Nếu `start.cmd` báo lỗi ngay khi mở, chụp màn hình gửi lại để xử lý.
- Về lâu dài nên dùng Windows Server 2016 trở lên, hoặc một máy Linux / Docker.
- Microsoft đã ngừng cập nhật bảo mật cho Server 2012 từ 10/2023. Chỉ nên mở hệ thống trong mạng nội bộ, không đưa thẳng ra Internet.

Tạo gói Windows (trên máy có Internet): `npm run package:windows`. Gói nhẹ: `npm run package:windows -- --no-node`.

## Cấu hình (`.env`)

| Biến | Ý nghĩa |
|---|---|
| `PORT` | Cổng web, mặc định `4000` |
| `DEMO_DATA` | `0`: hệ thống trống, chỉ có tài khoản quản trị. `1`: tạo dữ liệu mẫu (`admin / 123456`…) để dùng thử |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Tài khoản Chủ doanh nghiệp, tạo ở lần chạy đầu khi CSDL trống. Để trống mật khẩu thì hệ thống sinh ngẫu nhiên và in ra log |
| `COMPANY_NAME` | Tên công ty hiển thị lúc khởi tạo |
| `DATA_DIR` | Thư mục dữ liệu khi chạy bằng Node.js. Mặc định `./data`. Với Docker luôn là `./data` cạnh `docker-compose.yml` |
| `JWT_SECRET` | Khoá ký phiên đăng nhập. Không bắt buộc: để trống thì hệ thống tự sinh và lưu trong CSDL |

## Chuyển dữ liệu đang dùng trên Cloudflare về máy chủ

Script tải toàn bộ CSDL D1 và tệp đính kèm R2 về thư mục `data/`. Chạy trên máy chủ, hoặc trên bất kỳ máy nào có Node.js 22.5 trở lên rồi chép thư mục `data/` sang.

```bash
docker compose stop                      # nếu đang chạy
npm --prefix server install              # cài wrangler (một lần)
export CLOUDFLARE_API_TOKEN=...          # hoặc: npx --prefix server wrangler login
export CLOUDFLARE_ACCOUNT_ID=...
node server/scripts/import-cloudflare.mjs --data ./data --force
docker compose up -d
```

- `--force`: thay CSDL đang có. Bản cũ được giữ lại thành `data/app.db.bak-<thời gian>`.
- Nếu có tệp đính kèm tải lỗi, chạy lại với `--files-only` để chỉ tải phần còn thiếu.
- Nếu đã có sẵn tệp xuất D1 (`wrangler d1 export ldlvietnam-workspace-db --remote --output d1.sql`), dùng `--dump d1.sql`.
- Tài khoản và mật khẩu giữ nguyên như trên Cloudflare.
- **Máy chủ Windows (gói zip)**: gói không có npm / wrangler. Vì vậy hãy chạy lệnh trên ở một máy tính bất kỳ có Node.js 22.5 trở lên và mã nguồn (`git clone`). Sau đó:
  1. Chạy `uninstall-service.cmd` trên máy chủ, hoặc dừng task "LDL Workspace".
  2. Chép thư mục `data\` vừa tạo đè vào `C:\ldl-workspace\data\`.
  3. Chạy lại `install-service.cmd`.
- Từ lúc chuyển xong, dữ liệu mới chỉ ghi vào máy chủ. Hãy thông báo cho mọi người dùng địa chỉ mới.

## Sao lưu

- **Docker**: `docker compose exec ldl-workspace npm run -s backup`
- **Node.js**: `./backup.sh`
- **Windows**: `backup.cmd`. `install-service.cmd` đã tự đặt lịch 01:30 hằng đêm.

Mỗi lần sao lưu tạo `data/backups/app-YYYYMMDD-HHMM.db` và giữ 14 bản gần nhất (đổi bằng `--keep 30`). Tệp đính kèm được chép cộng dồn vào `data/backups/uploads/`. Lệnh chạy được cả khi ứng dụng đang hoạt động.

Đặt lịch sao lưu hằng đêm (`crontab -e`):

```
30 1 * * * cd /srv/ldl-workspace && docker compose exec -T ldl-workspace npm run -s backup >> data/backups/backup.log 2>&1
```

Nên chép định kỳ thư mục `data/backups/` sang ổ khác hoặc NAS.

**Khôi phục**:

1. Dừng ứng dụng.
2. Chép bản `app-….db` cần dùng thành `data/app.db`, và xoá `data/app.db-wal` / `data/app.db-shm` nếu có.
3. Chạy lại ứng dụng.

## HTTPS, tên miền, điện thoại

- Trong mạng nội bộ, dùng ngay được qua `http://IP:4000`.
- Một số chức năng của trình duyệt chỉ chạy trên HTTPS:
  - thông báo đẩy;
  - cài ứng dụng lên màn hình iPhone/Android;
  - thời tiết theo vị trí ở Trang chủ.
- Khi cần các chức năng trên, đặt một reverse proxy có chứng chỉ phía trước. Ví dụ Caddy (tự lấy chứng chỉ Let's Encrypt khi có tên miền trỏ về máy chủ):

  ```
  workspace.ldlvietnam.vn {
      reverse_proxy 127.0.0.1:4000
  }
  ```

  Nginx, IIS (ARR) hoặc Cloudflare Tunnel cũng dùng được. Proxy cần chuyển tiếp header `X-Forwarded-For`, để lịch sử đăng nhập và giới hạn IP chấm công nhận đúng IP người dùng.
- Mở cổng tường lửa:
  - Linux: `sudo ufw allow 4000/tcp`.
  - Windows: thêm Inbound Rule cho cổng 4000.
