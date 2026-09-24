# LDL Workspace

Webapp nội bộ gồm 2 phân hệ, giao diện và chức năng mô phỏng **LDL Office (Văn bản)** và **LDL Wework (Công việc & dự án)**.

## Chức năng

### Trang chủ (Home) — `/`
- Phần đầu trang: lời chào, đồng hồ, **thời tiết tại vị trí hiện tại** dạng tóm tắt nhỏ, bấm để xem chi tiết (định vị của thiết bị → ước lượng theo mạng → mặc định Hà Nội; dự báo 4 ngày, lời nhắc mưa / nắng nóng), ô đếm nhanh việc **quá hạn / hôm nay / sắp tới / tin chưa đọc**, sinh nhật; đổi hình nền.
- **Quan trọng cần lưu ý**: công việc khẩn cấp / quan trọng chưa xong mà bạn thực hiện, đã giao hoặc đang theo dõi — quá hạn lên đầu.
- **Việc cần làm**: gom công việc Wework, đề xuất & văn bản chờ duyệt, đề xuất bị trả lại, công việc chờ đánh giá, nhắc chấm công, lịch nghỉ sắp tới — chia tab Quá hạn / Hôm nay / Sắp tới / Cần xử lý.
- **Chat nhóm**: kênh toàn công ty và kênh phòng ban (tự tạo cho mỗi phòng ban, thành viên theo phòng ban của tài khoản).
- Lưới ứng dụng theo nhóm Work+ / HRM+ / Info+ / Finance+ / Platform, tìm kiếm ứng dụng; thông báo toàn công ty; ghi chú cá nhân.

### Giao diện
- Ngôn ngữ thiết kế chung lấy cảm hứng iOS 27: chữ hệ thống Apple, bo góc lớn, nút dạng viên thuốc, vật liệu kính mờ cho menu / hộp thoại / thông báo, điều khiển phân đoạn, chuyển động mềm.

### iPhone & điện thoại
- Thiết kế riêng cho màn hình iPhone (SE 375pt → Pro Max 440pt): né tai thỏ / Dynamic Island và thanh Home (safe-area), chiều cao màn hình chuẩn `dvh` (không bị thanh địa chỉ Safari che), ô nhập cỡ 16px để Safari không tự phóng to, vùng chạm ~44pt.
- **Thanh tab dưới đáy**: Trang chủ · Công việc · Tin nhắn (số chưa đọc) · Văn bản · Thêm (mọi ứng dụng, liên hệ nhanh, tài khoản). Tự ẩn trong cuộc trò chuyện và khi bàn phím mở.
- Hộp thoại thành **bảng trượt từ dưới lên**, menu thả xuống thành **action sheet**, chi tiết công việc toàn màn hình; thanh bên các phân hệ thành **ngăn kéo** (chạm ra ngoài để đóng); thanh dọc của Tài khoản / Đề xuất thành thanh ngang; danh sách thành viên, đề xuất hiển thị dạng thẻ; bảng "Công việc của tôi" giữ cột tên cố định và vuốt ngang các cột còn lại.
- Thêm vào màn hình chính (Add to Home Screen) để chạy toàn màn hình như ứng dụng.
- **Cài như ứng dụng**: iPhone / iPad — Safari → Chia sẻ → **Thêm vào MH chính**; Windows / macOS / Android — Edge hoặc Chrome → nút **Cài ứng dụng LDL** (Trang chủ, menu tài khoản, Tài khoản → Thông báo) hoặc ⋯ → Ứng dụng → Cài đặt. Ứng dụng mở trong cửa sổ riêng, ghim được vào taskbar / Start; bấm chuột phải biểu tượng trên taskbar (hoặc nhấn giữ trên Android) có lối tắt Công việc · Tin nhắn · Văn bản · Tạo đề xuất · Thông báo.
- **Số trên biểu tượng ứng dụng** (Màn hình chính iPhone, taskbar Windows, Dock macOS, Android) = số thông báo chưa đọc: cập nhật khi có thông báo đẩy, khi mở lại ứng dụng và khi đọc; mở công việc / đề xuất / văn bản / cuộc trò chuyện tự đánh dấu các thông báo liên quan đã đọc.
- **Thông báo đẩy (Web Push)**: sau khi thêm LDL vào Màn hình chính (iPhone iOS 16.4+; Android / máy tính dùng trực tiếp trong trình duyệt), bấm **Bật** ở dải nhắc trên Trang chủ hoặc Tài khoản → Thông báo. Mọi thông báo của hệ thống (giao việc, bình luận, nhắc tên, đề xuất cần duyệt, văn bản, tin nhắn 1-1 và nhóm riêng tư) hiện trên màn hình khoá kể cả khi không mở ứng dụng; bấm vào thông báo mở đúng nội dung; số chưa đọc hiện trên biểu tượng LDL. Có nút **Gửi thử** / **Tắt trên thiết bị này**; đăng xuất tự huỷ đăng ký của thiết bị. Khoá VAPID tự sinh lần đầu và lưu trong cơ sở dữ liệu (có thể đặt `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (JWK), `VAPID_SUBJECT` làm secret của Worker).

### Giao diện sáng / tối
- Mọi phân hệ hỗ trợ giao diện **Sáng**, **Tối** hoặc **Theo hệ thống** — chọn trong menu tài khoản (góc phải trên) hoặc nút mặt trời / mặt trăng ở Home. Lựa chọn được nhớ trên trình duyệt và đồng bộ theo tài khoản.
- **Màu thương hiệu** (nút bảng màu ở Home, 6 lựa chọn): áp cho Home, thanh trên cùng, thanh bên và rail của mọi phân hệ, trang đăng nhập.
- Bấm **logo / tên công ty** ở bất kỳ phân hệ nào để về trang chủ.

### Tài khoản (Account) — `/account` — nền tảng cho mọi phân hệ
- Hồ sơ cá nhân: thông tin liên hệ, quản lý trực tiếp, người báo cáo trực tiếp, nhóm, học vấn, kinh nghiệm, giải thưởng; đổi mật khẩu, **ảnh đại diện** (tự cắt vuông, hiển thị trên toàn hệ thống; quản trị viên đổi được cho từng thành viên), màu hiển thị, lịch sử đăng nhập.
- Thành viên: tìm kiếm, tab Tất cả / Quản trị hệ thống / Vô hiệu hoá / Lịch sử đăng nhập; tạo, sửa, vô hiệu hoá, đặt lại mật khẩu; **nhập / xuất Excel (CSV)**; nút **nhắn tin / gọi điện** ngay trên từng thành viên và hồ sơ.
- Vai trò: Thành viên · Tài khoản khách · **Quản trị hệ thống** (quản trị cấp cao) · **Chủ doanh nghiệp** (cấp cao nhất, toàn quyền như quản trị hệ thống). Quản trị viên thường không sửa, khoá, đổi mật khẩu hay đặt lại bảo mật được tài khoản Chủ doanh nghiệp; chỉ Chủ doanh nghiệp trao / thu hồi vai trò này (khi hệ thống chưa có Chủ doanh nghiệp, quản trị viên trao được lần đầu); luôn giữ ít nhất một Chủ doanh nghiệp.
- **Liên hệ nhanh** (biểu tượng danh bạ trên thanh trên cùng mọi phân hệ, hoặc tab Thêm trên điện thoại): tìm thành viên theo tên / chức danh / phòng ban / số điện thoại → **nhắn tin** qua LDL Message hoặc **gọi di động** (nếu đã có số); chọn nhiều người để **nhắn nhóm** (tạo kênh riêng tư).
- Nhóm người dùng, phòng ban (có **trưởng phòng**); một tài khoản có thể thuộc **nhiều phòng ban** (phòng ban chính + kiêm nhiệm: nhận văn bản, kênh chat, tài liệu của mọi phòng ban) và nhiều dự án; **Quản lý ứng dụng**: bật/tắt từng ứng dụng và phân quyền sử dụng theo tài khoản (được kiểm tra ở cả API).
- Chỉnh sửa công ty, lịch sử hệ thống (audit), đổi mật khẩu hàng loạt.

### Đề xuất (Request) — `/request`
- Nhóm đề xuất theo danh mục, **biểu mẫu tuỳ chỉnh** (văn bản, đoạn văn, số, số tiền, ngày, danh sách chọn, ô tích, nhân sự).
- Quy trình **duyệt lần lượt** hoặc **chỉ cần một người duyệt**, người duyệt mặc định + người tạo tự chọn thêm, người theo dõi mặc định, **SLA**.
- Tab Tất cả / Đến lượt duyệt / Quá hạn / Chờ xử lý / Đã chấp thuận / Đã từ chối / Đã trả lại / Đã đánh dấu / Đã lưu nháp; Gửi đến tôi / Tôi gửi đi / Đang theo dõi.
- Chấp thuận, từ chối, trả lại (kèm lý do), gửi lại, huỷ; bình luận, tệp đính kèm (**xem trước ngay trong trang**), lịch sử, thông báo.
- **Biểu mẫu & quy trình của nhóm đề xuất**: quản trị viên đính kèm biểu mẫu, tài liệu quy trình và hướng dẫn thực hiện; người làm đề xuất thấy ngay khi tạo đề xuất (xem trước / tải về), người duyệt đối chiếu trong trang chi tiết.
- Quản lý nhóm đề xuất: bật/tạm đóng, tác vụ hàng loạt, tạo từ mẫu, lịch sử chỉnh sửa.
- **Báo cáo đề xuất**: chỉ số tổng quan (chờ duyệt, chấp thuận, từ chối, quá SLA, thời gian xử lý TB), biểu đồ trạng thái, tỷ lệ đúng SLA, đề xuất mới theo ngày, theo nhóm đề xuất (xuất Excel) và theo người duyệt (thời gian phản hồi TB).

### Văn bản (Office) — `/office`
- Danh sách văn bản dạng **danh sách** hoặc **bảng**; tab *Tất cả / Thông báo / Văn bản đến / Văn bản đi / Văn bản nội bộ*.
- Sidebar: Trang chủ, Đang theo dõi, Chờ tôi duyệt, Yêu thích, Tạo bởi tôi, Duyệt cấp số văn bản, Văn bản của hệ thống,
  **Kho lưu trữ** (cây thư mục), **Loại văn bản**, **Cây thư mục**, Đến nội bộ, Gửi bởi, trạng thái (Đã lưu, Hết hạn, Không thông qua, Cất giữ, Đã tạm xóa).
- **Bộ lọc** (trạng thái, loại, người ban hành, phòng ban, khoảng ngày, sắp xếp), tìm kiếm toàn văn.
- **Tạo văn bản**: soạn thảo nội dung, đính kèm nhiều tệp, số hiệu, ngày hiệu lực / hết hạn, người nhận (người / phòng ban hoặc toàn công ty), người theo dõi.
- **Luồng duyệt nhiều bước** (tuần tự), duyệt / không thông qua kèm ý kiến, gửi lại sau khi sửa; **cấp số văn bản** (tự động hoặc nhập tay).
- **Văn bản thay thế chính sách cũ**: chọn văn bản cũ khi soạn (hoặc nút *Ban hành bản thay thế* trên văn bản cũ). Khi văn bản mới được ban hành và đến ngày hiệu lực, văn bản cũ tự chuyển sang *Đã bị thay thế* (rời danh sách đang áp dụng và thông báo toàn công ty), hiện biểu ngữ dẫn sang văn bản mới; người nhận / theo dõi / đã xem văn bản cũ được thông báo; có dòng thời gian *Các phiên bản*; huỷ văn bản mới thì văn bản cũ tự trở lại hiệu lực.
- Chi tiết văn bản: tệp đính kèm (**xem trước PDF / Word / ảnh ngay trong trang**, xem / tải), thảo luận, lịch sử hoạt động, danh sách người đã xem, in, sao chép liên kết.
- Đánh dấu yêu thích, theo dõi, cất giữ, tạm xóa / khôi phục / xóa vĩnh viễn, thao tác hàng loạt, **xuất CSV**, **quét văn bản** (tải bản scan → tạo văn bản đến nháp).

### Công việc & dự án (Wework) — `/wework`
- **Công việc của tôi** (dạng bảng theo Base Wework): tab *Giao cho tôi / Tôi giao đi / Đang theo dõi*; nhóm theo *Thời hạn* (Trước đây, Hôm nay, Ngày mai, 7 ngày tới, Trong tương lai, Không thời hạn), trạng thái, dự án hoặc mức ưu tiên; lọc trạng thái / dự án, sắp xếp, tìm kiếm; cột trạng thái, thời gian bắt đầu, thời hạn, hoàn thành, dự án, công việc cha, nhãn, kết quả, tạo bởi, giao cho (*Tuỳ chỉnh cột*); tích để hoàn thành, tạo nhanh công việc trong từng nhóm.
- **Phân quyền giao việc**: quản trị viên giao cho mọi người; quản lý trực tiếp giao cho nhân viên mình quản lý (cả cấp dưới gián tiếp); trưởng phòng giao cho nhân sự trong phòng ban; quản lý dự án giao cho thành viên dự án; ai cũng tự giao cho mình. Người được giao việc cập nhật trạng thái, kết quả, checklist, tệp, thảo luận nhưng **không được xoá công việc, đổi thời gian bắt đầu / thời hạn, sửa mô tả, đổi dự án, đổi lặp lại**.
- Trang Công việc: nhóm theo tuần, lọc *Giao & được giao / CV được giao / CV giao đi*, công việc con, trạng thái (Cần làm, Đang làm, Chờ đánh giá, Hoàn thành, Thất bại, Quá hạn, Hoàn thành muộn, Khẩn cấp, Quan trọng), dự án, sắp xếp.
- Tab: Nhân viên của tôi, **Bộ lọc tùy chỉnh** (lưu bộ lọc), Đang theo dõi, **Lịch biểu**, **CV lặp lại**.
- Panel phải: tỷ lệ hoàn thành, Mới được giao, Mới giao đi, Cảnh báo ưu tiên, **Mục tiêu** (gắn các công việc liên quan — tìm & gắn, bỏ gắn, tạo công việc mới cho mục tiêu; tiến độ tự tính theo % công việc đã hoàn thành hoặc nhập tay; chọn mục tiêu ngay trong công việc), bộ lọc tùy chỉnh, nhân viên của tôi.
- Chi tiết công việc: người thực hiện, người theo dõi, ngày bắt đầu / thời hạn, ưu tiên (*Bình thường / Quan trọng / Khẩn cấp / Quan trọng & khẩn cấp* — đủ 4 ô ma trận Eisenhower), mục tiêu, lặp lại (ngày / tuần / tháng — tự tạo kỳ tiếp theo khi hoàn thành),
  mô tả, **checklist**, **công việc con**, tệp đính kèm, thảo luận (gõ **@** để chọn người cần nhắc tên — người được nhắc nhận thông báo riêng và tự được thêm vào người theo dõi), **lịch sử ở cột bên phải**.
- **Cấp công việc cha / con**: nhãn *Việc cha · x/y việc con* và *Việc con (của …)*, việc con thụt lề dưới việc cha với đường nối, nút mở rộng để xem việc con ngay trong danh sách.
- **Người ngoài dự án / phòng ban** được giao hoặc mời theo dõi / phối hợp một công việc: xem, thảo luận, đính kèm tệp, cập nhật kết quả của riêng công việc đó mà không cần thêm vào dự án / phòng ban.
- **Dự án** (một dự án có thể phối hợp nhiều phòng ban) và **Phòng ban**: tạo mới / từ **mẫu**, lưu dự án thành mẫu, **thành viên & vai trò** (thêm từng người hoặc cả phòng ban, đổi vai trò quản lý / thành viên, xoá — quản lý dự án và quản trị viên), **nhóm công việc** (mọi thành viên tạo được ngay trong danh sách, Kanban, khi tạo / sửa công việc; quản lý dự án đổi tên / xoá);
  xem dạng **Danh sách**, **Kanban** (kéo thả), **Theo trạng thái**, **Lịch**, **Tiến độ (Gantt)**, Hoạt động, Báo cáo.
- Thành viên, **Tác vụ hàng loạt**, tìm nhanh.
- **Báo cáo tổng hợp** (bố cục theo Base Wework): bộ lọc thời gian / mốc ngày (tạo, thời hạn, bắt đầu, hoàn thành) / dự án / công việc con / trạng thái; thẻ tổng quan Dự án · Phòng ban · Công việc · Mục tiêu · Thành viên; biểu đồ tròn trạng thái (HT đúng hạn, đang xử lý, quá hạn, chờ đánh giá, HT muộn, thất bại), thành viên xuất sắc, công việc không đúng hạn, ma trận Eisenhower, chờ đánh giá; quá trình theo ngày (luỹ kế) và tổng hợp theo tuần; công việc được giao / đã tạo theo thành viên (xuất Excel), còn nhiều việc nhất, làm muộn nhiều nhất, tạo nhiều / chưa giao nhiều nhất; dự án & phòng ban, sức khoẻ dự án, phân bổ theo phòng ban; mục tiêu và các con số thống kê. Mọi biểu đồ có tooltip, chú thích và chế độ xem dạng bảng.
- **Popup chi tiết báo cáo**: bấm vào bất kỳ con số, phần biểu đồ tròn / chú thích, cột theo ngày / tuần / phòng ban, ô trong bảng thành viên / dự án, ma trận Eisenhower, mục tiêu... để mở danh sách công việc liên quan (tìm kiếm, xuất Excel) và mở thẳng chi tiết từng công việc.
- **Quyền xem báo cáo**: báo cáo (toàn công ty và tab Báo cáo trong dự án) chỉ hiển thị cho quản trị viên và các cá nhân / nhóm / phòng ban được cấp quyền (nút *Phân quyền xem báo cáo* trên trang Báo cáo, kiểm tra ở cả API). Người được cấp quyền xem số liệu toàn công ty và mở được chi tiết công việc từ báo cáo.
- **Kết quả công việc**: người thực hiện / người giao / quản lý dự án cập nhật kết quả cụ thể theo từng lần — nội dung văn bản, liên kết (mở trực tiếp), tệp (Word, Excel, PowerPoint, PDF, ảnh, video, âm thanh...); có thông báo cho người giao việc và người theo dõi, sửa / xoá, số kết quả hiển thị trên danh sách công việc.
- **Xem tệp trực tiếp**: ảnh, video (tua được), âm thanh, PDF, văn bản / mã nguồn, CSV, Word (.docx), Excel (.xlsx, nhiều trang tính) xem ngay trong trình duyệt; mọi định dạng Office (doc, docx, xls, xlsx, ppt, pptx, odt...) còn xem được qua Microsoft Office Online / Google Viewer bằng liên kết tạm có chữ ký 15 phút (cần máy chủ truy cập được từ Internet).

### Nhắc tên @ trong mọi bình luận
- Gõ **@** trong bình luận công việc (Wework), thảo luận văn bản (Office), thảo luận đề xuất (Request), tin nhắn LDL Message và ô chat nhanh ở Trang chủ → danh sách gợi ý (lọc theo tên / tên đăng nhập, không cần dấu; ↑ ↓ Enter hoặc chạm để chọn). Nội dung hiển thị thành **@Họ tên** nổi bật.
- Người được nhắc nhận thông báo riêng "… đã nhắc đến bạn …" (kèm thông báo đẩy) và **được thêm vào người theo dõi** để mở được công việc / đề xuất / văn bản đó (kể cả văn bản đang dự thảo). Trong chat chỉ nhắc được người xem được kênh (thành viên kênh riêng tư, nhân sự phòng ban).

### Bảo mật
- **Bảo mật hai lớp (2FA)** theo chuẩn TOTP — quét mã QR bằng Google / Microsoft Authenticator; quản trị viên có thể đặt lại 2FA cho thành viên.
- **Giới hạn truy cập theo dải IP** (IPv4, CIDR) — quản trị viên luôn được truy cập để tránh bị khoá ngoài.
- **Tài khoản khách** (đối tác, NPP): có ngày hết hạn, chỉ dùng các ứng dụng được cấp, không xem danh bạ và văn bản công khai.

### Webhook LDL Request — `/request/settings/webhooks`
- Gửi sự kiện (tạo, duyệt từng bước, chấp thuận, từ chối, trả lại, huỷ, bình luận) tới URL HTTPS; ký `X-LDL-Signature: sha256=<HMAC>` bằng secret; lọc theo nhóm đề xuất; nhật ký gửi và nút gửi thử.

### HRM+ — `/hrm`, `/checkin`, `/timeoff`
- **LDL HRM**: hồ sơ nhân sự (mã NV, CCCD, hợp đồng, BHXH, MST, ngân hàng...), tổng quan theo phòng ban, cảnh báo hết hạn hợp đồng / thử việc, sinh nhật, nhân sự mới.
- **LDL Checkin**: chấm công vào / ra (giờ Việt Nam), đi muộn / về sớm, bảng công tháng dạng lịch, bảng công nhân viên theo ngày, xuất CSV, giới hạn chấm công theo IP văn phòng.
- **LDL Timeoff**: quỹ phép năm theo nhân viên, đơn nghỉ đi qua **LDL Request** (nhóm "Đề xuất nghỉ phép"), lịch nghỉ công ty.

### LDL Drive — `/drive`
- Tài liệu của tôi / tài liệu công ty / được chia sẻ / gần đây / thùng rác; thư mục lồng nhau, tải lên kéo thả, đổi tên, di chuyển, xem trực tuyến, tải xuống.
- Chia sẻ cho thành viên / phòng ban / nhóm với quyền Xem hoặc Chỉnh sửa (kế thừa theo thư mục cha).

### LDL Message — `/message`
- Kênh công khai / riêng tư, tin nhắn 1-1 (nút **gọi điện** trong cuộc trò chuyện 1-1 khi người kia có số điện thoại), số tin chưa đọc, gửi tệp / ảnh (**xem trước** mọi định dạng), **biểu tượng cảm xúc**, sửa / xoá tin nhắn của mình, nhắc tên `@tên_đăng_nhập` (có thông báo), tìm kiếm tin nhắn.
- Thêm thành viên vào kênh riêng tư: chọn quyền **xem toàn bộ tin nhắn cũ / 7 ngày gần đây / không xem tin cũ**. Quản trị viên (hoặc người tạo) **xoá kênh** cùng toàn bộ tin nhắn và tệp.
- Enter gửi / Shift+Enter xuống dòng; chống gửi trùng khi nhấn Enter liên tiếp hoặc đang gõ dấu tiếng Việt; tin hiện ngay khi gửi; mỗi cặp người chỉ có một cuộc trò chuyện 1-1 (bấm liên tục không tạo trùng).
- Cập nhật tin nhắn mới mỗi ~2,5 giây trong cuộc trò chuyện đang mở (polling nhẹ, tạm dừng khi tab ẩn).

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
