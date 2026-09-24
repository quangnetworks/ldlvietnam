# LDL Workspace

Webapp nội bộ gồm 2 phân hệ, giao diện và chức năng mô phỏng **Base Office (Văn bản)** và **Base Wework (Công việc & dự án)**.

## Chức năng

### Trang chủ (Home) — `/`
- Màn hình khởi động toàn hệ sinh thái: lưới ứng dụng theo nhóm Work+ / HRM+ / Info+ / Finance+ / Platform, tìm kiếm ứng dụng.
- Ứng dụng chưa được cấp quyền hiển thị khoá; ứng dụng chưa phát triển có nhãn "Sắp ra mắt".
- Đồng hồ, lời chào, việc cần làm (đề xuất / văn bản chờ duyệt, công việc quá hạn), sinh nhật, thông báo toàn công ty, ghi chú cá nhân, đổi hình nền.

### Tài khoản (Account) — `/account` — nền tảng cho mọi phân hệ
- Hồ sơ cá nhân: thông tin liên hệ, quản lý trực tiếp, người báo cáo trực tiếp, nhóm, học vấn, kinh nghiệm, giải thưởng; đổi mật khẩu, màu hiển thị, lịch sử đăng nhập.
- Thành viên: tìm kiếm, tab Tất cả / Quản trị hệ thống / Vô hiệu hoá / Lịch sử đăng nhập; tạo, sửa, vô hiệu hoá, đặt lại mật khẩu; **nhập / xuất Excel (CSV)**.
- Nhóm người dùng, phòng ban; **Quản lý ứng dụng**: bật/tắt từng ứng dụng và phân quyền sử dụng theo tài khoản (được kiểm tra ở cả API).
- Chỉnh sửa công ty, lịch sử hệ thống (audit), đổi mật khẩu hàng loạt.

### Đề xuất (Request) — `/request`
- Nhóm đề xuất theo danh mục, **biểu mẫu tuỳ chỉnh** (văn bản, đoạn văn, số, số tiền, ngày, danh sách chọn, ô tích, nhân sự).
- Quy trình **duyệt lần lượt** hoặc **chỉ cần một người duyệt**, người duyệt mặc định + người tạo tự chọn thêm, người theo dõi mặc định, **SLA**.
- Tab Tất cả / Đến lượt duyệt / Quá hạn / Chờ xử lý / Đã chấp thuận / Đã từ chối / Đã trả lại / Đã đánh dấu / Đã lưu nháp; Gửi đến tôi / Tôi gửi đi / Đang theo dõi.
- Chấp thuận, từ chối, trả lại (kèm lý do), gửi lại, huỷ; bình luận, tệp đính kèm, lịch sử, thông báo.
- Quản lý nhóm đề xuất: bật/tạm đóng, tác vụ hàng loạt, tạo từ mẫu, lịch sử chỉnh sửa; báo cáo theo nhóm và người duyệt.

### Văn bản (Office) — `/office`
- Danh sách văn bản dạng **danh sách** hoặc **bảng**; tab *Tất cả / Thông báo / Văn bản đến / Văn bản đi / Văn bản nội bộ*.
- Sidebar: Trang chủ, Đang theo dõi, Chờ tôi duyệt, Yêu thích, Tạo bởi tôi, Duyệt cấp số văn bản, Văn bản của hệ thống,
  **Kho lưu trữ** (cây thư mục), **Loại văn bản**, **Cây thư mục**, Đến nội bộ, Gửi bởi, trạng thái (Đã lưu, Hết hạn, Không thông qua, Cất giữ, Đã tạm xóa).
- **Bộ lọc** (trạng thái, loại, người ban hành, phòng ban, khoảng ngày, sắp xếp), tìm kiếm toàn văn.
- **Tạo văn bản**: soạn thảo nội dung, đính kèm nhiều tệp, số hiệu, ngày hiệu lực / hết hạn, người nhận (người / phòng ban hoặc toàn công ty), người theo dõi.
- **Luồng duyệt nhiều bước** (tuần tự), duyệt / không thông qua kèm ý kiến, gửi lại sau khi sửa; **cấp số văn bản** (tự động hoặc nhập tay).
- Chi tiết văn bản: tệp đính kèm (xem / tải), thảo luận, lịch sử hoạt động, danh sách người đã xem, in, sao chép liên kết.
- Đánh dấu yêu thích, theo dõi, cất giữ, tạm xóa / khôi phục / xóa vĩnh viễn, thao tác hàng loạt, **xuất CSV**, **quét văn bản** (tải bản scan → tạo văn bản đến nháp).

### Công việc & dự án (Wework) — `/wework`
- Trang Công việc: nhóm theo tuần, lọc *Giao & được giao / CV được giao / CV giao đi*, công việc con, trạng thái (Cần làm, Đang làm, Chờ đánh giá, Hoàn thành, Thất bại, Quá hạn, Hoàn thành muộn, Khẩn cấp, Quan trọng), dự án, sắp xếp.
- Tab: Nhân viên của tôi, **Bộ lọc tùy chỉnh** (lưu bộ lọc), Đang theo dõi, **Lịch biểu**, **CV lặp lại**.
- Panel phải: tỷ lệ hoàn thành, Mới được giao, Mới giao đi, Cảnh báo ưu tiên, **Mục tiêu**, bộ lọc tùy chỉnh, nhân viên của tôi.
- Chi tiết công việc: người thực hiện, người theo dõi, ngày bắt đầu / thời hạn, ưu tiên, lặp lại (ngày / tuần / tháng — tự tạo kỳ tiếp theo khi hoàn thành),
  mô tả, **checklist**, **công việc con**, tệp đính kèm, thảo luận (nhắc tên bằng `@tên_đăng_nhập`), lịch sử.
- Dự án & phòng ban: tạo mới / từ **mẫu**, lưu dự án thành mẫu, thành viên & vai trò, nhóm công việc;
  xem dạng **Danh sách**, **Kanban** (kéo thả), **Theo trạng thái**, **Lịch**, **Tiến độ (Gantt)**, Hoạt động, Báo cáo.
- Thành viên, **Báo cáo** (theo trạng thái, thành viên, dự án, xu hướng 30 ngày), **Tác vụ hàng loạt**, tìm nhanh.

### Chung
- Đăng nhập, thông báo thời gian thực (polling), chuyển ứng dụng, tài khoản & đổi mật khẩu.
- **Cài đặt Office**: quyền tạo văn bản (tất cả / người / nhóm / phòng ban), văn thư cấp số, mẫu số hiệu `{seq}/{year}/{prefix}-LDL`, hạn hiệu lực mặc định; loại văn bản / kho / thư mục.

## Công nghệ
- **Backend**: [Hono](https://hono.dev) — cùng một mã nguồn chạy trên **Cloudflare Workers** (D1 + R2) hoặc **Node.js ≥ 22.5** (SQLite tích hợp `node:sqlite` + thư mục tệp).
- **Frontend**: React 19 + Vite, React Router, lucide-react.
- Mật khẩu băm PBKDF2-SHA256 (Web Crypto), phiên đăng nhập JWT trong cookie HttpOnly.

## Deploy lên Cloudflare

Xem **[DEPLOY.md](DEPLOY.md)** — chỉ cần thêm 2 secret (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) vào GitHub,
workflow sẽ tự tạo D1, R2, dữ liệu ban đầu và deploy.

## Chạy trên máy (Node.js)

```bash
npm run install:all   # cài phụ thuộc cho server và client
npm run build         # build giao diện
npm start             # http://localhost:4000
```

Lần chạy đầu tiên tự tạo dữ liệu mẫu. Tài khoản: `admin / 123456` (quản trị), `demo / 123456` (nhân viên),
`giamdoc`, `chilan`, `truongkd`, `minhtrang`, `thuhuyen`, `phuonglinh`, `duylinh`, `hoangcong` — mật khẩu đều là `123456`.

Phát triển (hot reload): `npm run dev:server` và `npm run dev:client` (mở http://localhost:5173).

Tạo lại dữ liệu mẫu: `npm run seed`. Kiểm thử API: `npm test`.

Biến môi trường (Node): `PORT` (mặc định 4000), `DATA_DIR` (CSDL & tệp tải lên, mặc định `server/data`), `JWT_SECRET`.
