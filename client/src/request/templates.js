/**
 * Mẫu nhóm đề xuất (Request → Quản lý nhóm → Tạo nhóm từ mẫu) cho công ty phân phối hàng tiêu dùng:
 * mạng lưới NPP / đại lý / siêu thị (KA), đội PG, kho vận, khuyến mãi – trưng bày, công nợ.
 * Mẫu chỉ điền sẵn biểu mẫu và luồng duyệt; người duyệt do quản trị chọn khi lưu nhóm.
 */
const f = (label, type = 'text', extra = {}) => ({ label, type, ...extra });
const req = (label, type = 'text', extra = {}) => f(label, type, { required: true, ...extra });
const sel = (label, options, required = true) => f(label, 'select', { options, required });

const CHANNELS = ['Nhà phân phối (GT)', 'Đại lý / bán sỉ', 'Siêu thị & chuỗi (MT/KA)', 'Thương mại điện tử', 'Tất cả kênh'];
const INDUSTRIES = ['Thực phẩm', 'Hóa mỹ phẩm', 'Cả hai ngành'];
const REGIONS = ['Miền Bắc', 'Miền Trung', 'Miền Nam', 'Miền Tây', 'Toàn quốc'];

export const TEMPLATES = [
  // ---------------- Kinh doanh
  { name: 'Đề xuất mở mới NPP / Đại lý', category: 'Kinh doanh', flow: 'sequential', sla_hours: 48,
    description: 'Đánh giá đối tác trước khi ký hợp đồng phân phối. Đính kèm GPKD, CCCD người đại diện, hình ảnh kho và xe giao hàng.',
    fields: [
      req('Tên đối tác'), sel('Loại đối tác', ['NPP cấp 1', 'Đại lý', 'Bán sỉ', 'Siêu thị / chuỗi (KA)']), sel('Ngành hàng', INDUSTRIES),
      req('Tỉnh / khu vực phụ trách'), req('Mã số thuế'), req('Người đại diện & số điện thoại'),
      req('Doanh số cam kết / tháng', 'money'), f('Hạn mức công nợ đề nghị', 'money'),
      req('Năng lực kho, xe, nhân viên bán hàng', 'textarea'), f('Độ phủ điểm bán hiện có (số cửa hàng)', 'number'),
      f('Đã đính kèm hồ sơ pháp lý và hình ảnh kho', 'checkbox'),
    ] },
  { name: 'Đề xuất chương trình khuyến mãi / trưng bày', category: 'Kinh doanh', flow: 'sequential', sla_hours: 48,
    description: 'Promotion brief: phạm vi, cơ chế, ngân sách và cách đo hiệu quả trước khi triển khai xuống NPP.',
    fields: [
      req('Tên chương trình'), sel('Hình thức', ['Chiết khấu trên hoá đơn', 'Tặng hàng', 'Trưng bày', 'Tích luỹ doanh số / trả thưởng', 'Dùng thử / sampling']),
      sel('Kênh áp dụng', CHANNELS), sel('Khu vực áp dụng', REGIONS), sel('Ngành hàng', INDUSTRIES),
      req('Áp dụng từ ngày', 'date'), req('Đến ngày', 'date'), req('Sản phẩm áp dụng', 'textarea'),
      req('Cơ chế & điều kiện nhận', 'textarea'), req('Ngân sách dự kiến', 'money'), f('Doanh số tăng thêm mục tiêu', 'money'),
      f('Cách nghiệm thu & đo hiệu quả', 'textarea'),
    ] },
  { name: 'Đề nghị quyết toán khuyến mãi / trả thưởng NPP', category: 'Kinh doanh', flow: 'sequential', sla_hours: 72,
    description: 'Quyết toán sau chương trình đã duyệt. Đính kèm bảng tính khuyến mãi và biên bản nghiệm thu trưng bày.',
    fields: [
      req('Nhà phân phối / đại lý'), req('Chương trình áp dụng'), req('Kỳ quyết toán (tháng)'),
      req('Doanh số đạt', 'money'), req('Giá trị đề nghị quyết toán', 'money'),
      sel('Hình thức chi trả', ['Trừ công nợ', 'Chuyển khoản', 'Trả bằng hàng']), f('Ghi chú đối chiếu', 'textarea'),
    ] },
  { name: 'Đề xuất chính sách bán hàng cho NPP', category: 'Kinh doanh', flow: 'sequential', sla_hours: 48, fields: [
    req('Nhà phân phối'), sel('Khu vực', REGIONS), req('Mức chiết khấu đề xuất (%)', 'number'), f('Doanh số cam kết', 'money'), f('Lý do', 'textarea')] },
  { name: 'Đề xuất giá / đơn hàng đặc biệt', category: 'Kinh doanh', flow: 'sequential', sla_hours: 12,
    description: 'Đơn hàng ngoài chính sách giá hiện hành (số lượng lớn, dự án, khách hàng chiến lược).',
    fields: [
      req('Khách hàng'), req('Sản phẩm & số lượng', 'textarea'), req('Giá đề xuất so với giá chính sách', 'textarea'),
      req('Tổng giá trị đơn hàng', 'money'), sel('Điều kiện thanh toán', ['Thanh toán trước', 'Thanh toán khi nhận hàng', 'Công nợ theo hạn mức']),
      req('Lý do / lợi ích', 'textarea'),
    ] },
  { name: 'Đề xuất cấp / điều chỉnh hạn mức công nợ', category: 'Kinh doanh', flow: 'sequential', sla_hours: 24,
    description: 'Kế toán công nợ xác nhận số liệu trước khi trình duyệt.',
    fields: [
      req('Nhà phân phối / khách hàng'), f('Hạn mức hiện tại', 'money'), req('Hạn mức đề nghị', 'money'), req('Thời hạn thanh toán (ngày)', 'number'),
      f('Công nợ quá hạn hiện tại', 'money'), f('Doanh số bình quân 3 tháng gần nhất', 'money'),
      sel('Bảo đảm', ['Không', 'Đặt cọc', 'Bảo lãnh ngân hàng', 'Tài sản thế chấp'], false), req('Lý do', 'textarea'),
    ] },
  { name: 'Đề xuất đổi trả / xử lý hàng cận date', category: 'Kinh doanh', flow: 'sequential', sla_hours: 24,
    description: 'Ghi rõ số lô và hạn sử dụng. Đính kèm hình ảnh hàng hoá.',
    fields: [
      req('Khách hàng / NPP'), sel('Lý do', ['Cận hạn sử dụng', 'Hư hỏng, móp méo', 'Lỗi chất lượng', 'Giao sai hàng', 'Tồn kho chậm bán']),
      req('Sản phẩm & số lượng', 'textarea'), req('Số lô / hạn sử dụng'), req('Giá trị ước tính', 'money'),
      sel('Phương án xử lý', ['Đổi hàng mới', 'Nhận trả, giảm công nợ', 'Hỗ trợ bán xả hàng', 'Tiêu huỷ']),
    ] },
  { name: 'Đề xuất listing / hợp đồng siêu thị (KA)', category: 'Kinh doanh', flow: 'sequential', sla_hours: 72, fields: [
    req('Chuỗi / siêu thị'), req('Sản phẩm đăng ký', 'textarea'), f('Số cửa hàng áp dụng', 'number'), f('Phí listing / phí vào kệ', 'money'),
    f('Chiết khấu thương mại (%)', 'number'), f('Thời hạn hợp đồng'), req('Doanh số dự kiến / tháng', 'money'), f('Điều khoản cần lưu ý', 'textarea')] },
  { name: 'Đề xuất tuyển / bố trí PG tại điểm bán', category: 'Kinh doanh', flow: 'sequential', sla_hours: 48, fields: [
    req('Điểm bán / siêu thị'), sel('Ngành hàng', INDUSTRIES), req('Số lượng PG', 'number'), req('Từ ngày', 'date'), f('Đến ngày', 'date'),
    req('Chi phí lương & hỗ trợ', 'money'), f('Chỉ tiêu bán / PG / tháng', 'money'), f('Ghi chú', 'textarea')] },
  { name: 'Đề xuất thanh lý / chấm dứt hợp đồng NPP', category: 'Kinh doanh', flow: 'sequential', sla_hours: 72,
    description: 'Chốt công nợ, hàng tồn và phương án tiếp quản thị trường trước khi chấm dứt.',
    fields: [
      req('Nhà phân phối'), req('Khu vực'), req('Lý do chấm dứt', 'textarea'), req('Công nợ còn lại', 'money'), f('Hàng tồn tại NPP (giá trị)', 'money'),
      req('Ngày dự kiến chấm dứt', 'date'), req('Phương án tiếp quản thị trường', 'textarea'),
    ] },
  { name: 'Đề xuất xuất hàng mẫu / hàng tặng', category: 'Kinh doanh', flow: 'any', sla_hours: 12, fields: [
    sel('Mục đích', ['Mẫu cho khách hàng mới', 'Dùng thử tại điểm bán', 'Sự kiện / hội chợ', 'Quà tặng đối tác']), req('Sản phẩm & số lượng', 'textarea'),
    f('Giá trị ước tính', 'money'), req('Người / đơn vị nhận'), req('Ngày cần hàng', 'date')] },

  // ---------------- Kho vận
  { name: 'Đề xuất điều chuyển hàng giữa kho', category: 'Kho vận', flow: 'any', sla_hours: 8, fields: [
    req('Từ kho'), req('Đến kho / NPP'), req('Sản phẩm & số lượng', 'textarea'), req('Ngày cần hàng', 'date'),
    sel('Phương tiện', ['Xe công ty', 'Thuê ngoài', 'Gửi chành xe'], false), f('Ghi chú', 'textarea')] },
  { name: 'Đề xuất thuê vận chuyển ngoài', category: 'Kho vận', flow: 'sequential', sla_hours: 12, fields: [
    req('Tuyến giao (từ – đến)'), req('Ngày giao', 'date'), req('Khối lượng / số kiện'), req('Đơn vị vận chuyển'), req('Chi phí', 'money'), f('Lý do thuê ngoài', 'textarea')] },
  { name: 'Báo cáo chênh lệch kiểm kê / hàng hư hỏng', category: 'Kho vận', flow: 'sequential', sla_hours: 48, fields: [
    req('Kho'), req('Kỳ kiểm kê', 'date'), req('Sản phẩm chênh lệch / hư hỏng', 'textarea'), req('Giá trị chênh lệch', 'money'),
    req('Nguyên nhân', 'textarea'), sel('Đề xuất xử lý', ['Điều chỉnh sổ sách', 'Quy trách nhiệm bồi thường', 'Tiêu huỷ', 'Kiểm kê lại'])] },
  { name: 'Đề xuất đặt hàng nhà cung cấp / nhà máy', category: 'Kho vận', flow: 'sequential', sla_hours: 24, fields: [
    req('Nhà cung cấp / nhà máy'), req('Sản phẩm & số lượng', 'textarea'), f('Tồn kho hiện tại & số ngày bán', 'textarea'),
    req('Tổng giá trị', 'money'), req('Ngày cần hàng về kho', 'date'), f('Điều kiện thanh toán')] },

  // ---------------- Tài chính - Kế toán
  { name: 'Đề nghị tạm ứng', category: 'Tài chính - Kế toán', flow: 'sequential', sla_hours: 48, fields: [
    req('Số tiền', 'money'), req('Mục đích', 'textarea'), f('Ngày hoàn ứng', 'date')] },
  { name: 'Đề nghị hoàn ứng / quyết toán tạm ứng', category: 'Tài chính - Kế toán', flow: 'sequential', sla_hours: 48, fields: [
    req('Số tiền đã tạm ứng', 'money'), req('Số tiền đã chi', 'money'), sel('Chênh lệch', ['Hoàn lại công ty', 'Công ty chi bổ sung', 'Không chênh lệch']),
    req('Diễn giải các khoản chi', 'textarea')] },
  { name: 'Đề nghị thanh toán', category: 'Tài chính - Kế toán', flow: 'sequential', sla_hours: 48, fields: [
    req('Số tiền', 'money'), req('Người thụ hưởng'), sel('Hình thức', ['Chuyển khoản', 'Tiền mặt'], false), f('Diễn giải', 'textarea')] },
  { name: 'Đề nghị xuất / điều chỉnh hoá đơn', category: 'Tài chính - Kế toán', flow: 'any', sla_hours: 8, fields: [
    req('Khách hàng'), req('Mã số thuế'), sel('Loại yêu cầu', ['Xuất hoá đơn mới', 'Điều chỉnh thông tin', 'Điều chỉnh giá / số lượng', 'Thay thế', 'Huỷ']),
    f('Số hoá đơn liên quan'), f('Giá trị', 'money'), req('Nội dung & lý do', 'textarea')] },
  { name: 'Đề nghị đối chiếu / xác nhận công nợ', category: 'Tài chính - Kế toán', flow: 'any', sla_hours: 24, fields: [
    req('Nhà phân phối / khách hàng'), req('Kỳ đối chiếu (đến ngày)', 'date'), req('Số dư theo sổ công ty', 'money'),
    f('Số dư theo đối tác', 'money'), f('Chênh lệch & nguyên nhân', 'textarea')] },

  // ---------------- Hành chính - Nhân sự
  { name: 'Đề xuất nghỉ phép', category: 'Hành chính - Nhân sự', flow: 'sequential', sla_hours: 24, fields: [
    req('Nghỉ từ ngày', 'date'), req('Đến ngày', 'date'), sel('Loại nghỉ', ['Nghỉ phép năm', 'Nghỉ không lương', 'Nghỉ ốm', 'Nghỉ chế độ (cưới, tang…)']), req('Lý do', 'textarea')] },
  { name: 'Đề xuất làm thêm giờ', category: 'Hành chính - Nhân sự', flow: 'sequential', sla_hours: 12, fields: [
    req('Ngày làm thêm', 'date'), req('Số giờ', 'number'), req('Nội dung công việc', 'textarea')] },
  { name: 'Đề xuất đi công tác', category: 'Hành chính - Nhân sự', flow: 'sequential', sla_hours: 24, fields: [
    req('Nơi công tác'), req('Từ ngày', 'date'), req('Đến ngày', 'date'), f('Mục đích (thị trường, NPP làm việc)', 'textarea'), f('Dự trù chi phí', 'money')] },
  { name: 'Đánh giá kết thúc thử việc', category: 'Hành chính - Nhân sự', flow: 'sequential', sla_hours: 48,
    description: 'Quản lý trực tiếp đánh giá trước ngày hết thử việc (LDL HRM nhắc trước 7 ngày).',
    fields: [
      req('Nhân sự', 'user'), req('Ngày hết thử việc', 'date'), req('Kết quả công việc', 'textarea'),
      sel('Đề xuất', ['Ký hợp đồng chính thức', 'Gia hạn thử việc', 'Không tiếp nhận']), f('Mức lương đề xuất sau thử việc', 'money'),
    ] },
  { name: 'Đề xuất điều chỉnh lương / phụ cấp', category: 'Hành chính - Nhân sự', flow: 'sequential', sla_hours: 72, fields: [
    req('Nhân sự', 'user'), f('Thu nhập hiện tại', 'money'), req('Thu nhập đề xuất', 'money'), req('Áp dụng từ ngày', 'date'), req('Lý do / thành tích', 'textarea')] },
  { name: 'Đề xuất điều chuyển / bổ nhiệm', category: 'Hành chính - Nhân sự', flow: 'sequential', sla_hours: 72, fields: [
    req('Nhân sự', 'user'), req('Vị trí / khu vực hiện tại'), req('Vị trí / khu vực mới'), req('Ngày hiệu lực', 'date'), req('Lý do', 'textarea')] },
  { name: 'Đơn xin nghỉ việc', category: 'Hành chính - Nhân sự', flow: 'sequential', sla_hours: 72,
    description: 'Sau khi duyệt, mở thủ tục nghỉ việc (bàn giao tài sản, công việc, công nợ khách hàng).',
    fields: [req('Ngày nghỉ dự kiến', 'date'), req('Lý do', 'textarea'), f('Người nhận bàn giao', 'user'), f('Công nợ khách hàng đang phụ trách', 'textarea')] },
  { name: 'Đề xuất đào tạo', category: 'Hành chính - Nhân sự', flow: 'sequential', sla_hours: 48, fields: [
    req('Khoá học / nội dung'), req('Người tham gia', 'textarea'), req('Thời gian', 'date'), f('Chi phí', 'money'), f('Mục tiêu áp dụng', 'textarea')] },
  { name: 'Đề xuất cấp văn phòng phẩm / đồng phục', category: 'Hành chính - Nhân sự', flow: 'any', sla_hours: 24, fields: [
    req('Danh sách & số lượng', 'textarea'), f('Bộ phận sử dụng'), f('Ngày cần', 'date')] },

  // ---------------- Pháp lý - Văn bản
  { name: 'Đề xuất rà soát & ký hợp đồng', category: 'Pháp lý - Văn bản', flow: 'sequential', sla_hours: 48,
    description: 'Mọi hợp đồng với NPP, nhà cung cấp, siêu thị trước khi ký. Đính kèm bản dự thảo.',
    fields: [
      req('Đối tác'), sel('Loại hợp đồng', ['Phân phối / đại lý', 'Mua hàng / gia công', 'Siêu thị / KA', 'Dịch vụ', 'Thuê kho / xe', 'Khác']),
      f('Giá trị', 'money'), req('Thời hạn'), f('Điều khoản cần lưu ý', 'textarea'),
    ] },
  { name: 'Đề xuất sử dụng con dấu / giấy uỷ quyền', category: 'Pháp lý - Văn bản', flow: 'any', sla_hours: 8, fields: [
    req('Tài liệu cần đóng dấu / uỷ quyền'), req('Số bản', 'number'), req('Mục đích', 'textarea'), f('Ngày cần', 'date')] },

  // ---------------- Mua hàng & IT
  { name: 'Đề xuất mua hàng', category: 'Mua hàng', flow: 'any', sla_hours: 24, fields: [
    req('Danh sách hàng hoá', 'textarea'), req('Tổng giá trị dự kiến', 'money'), f('Nhà cung cấp')] },
  { name: 'Đề xuất cấp tài khoản / thiết bị IT', category: 'IT', flow: 'any', sla_hours: 8, fields: [
    req('Người sử dụng', 'user'), sel('Hạng mục', ['Tài khoản phần mềm (DMS, Workspace…)', 'Máy tính', 'Điện thoại', 'Khác']), f('Mô tả chi tiết', 'textarea')] },
];

/** Thứ tự hiển thị nhóm mẫu */
export const TEMPLATE_CATEGORIES = ['Kinh doanh', 'Kho vận', 'Tài chính - Kế toán', 'Hành chính - Nhân sự', 'Pháp lý - Văn bản', 'Mua hàng', 'IT'];
