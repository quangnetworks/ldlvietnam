import type { Guest, GuestStatus } from './types';

/**
 * DỮ LIỆU MINH HỌA — không phải khách mời thật.
 * Dùng để trình diễn khả năng cá nhân hóa trong giai đoạn UI.
 */
export const demoGuests: Guest[] = [
  { guest_id: 'HM-0001', guest_name: 'Nguyễn Văn A', salutation: 'Anh', display_name: 'Anh Nguyễn Văn A', guest_group: 'Bạn chú rể', note: '', invitation_status: 'ready' },
  { guest_id: 'HM-0002', guest_name: 'Trần Thị B', salutation: 'Chị', display_name: 'Chị Trần Thị B', guest_group: 'Đồng nghiệp', note: 'Đi cùng 1 người', invitation_status: 'exported' },
  { guest_id: 'HM-0003', guest_name: 'Lê Hoàng C', salutation: 'Gia đình', display_name: 'Gia đình anh Lê Hoàng C', guest_group: 'Họ hàng nhà trai', note: '', invitation_status: 'exported' },
  { guest_id: 'HM-0004', guest_name: 'Phạm Minh D', salutation: 'Bạn', display_name: 'Bạn Phạm Minh D', guest_group: 'Bạn cô dâu', note: '', invitation_status: 'draft' },
  { guest_id: 'HM-0005', guest_name: 'Võ Thị E', salutation: 'Cô', display_name: 'Cô Võ Thị E', guest_group: 'Họ hàng nhà gái', note: 'Ở Cà Mau', invitation_status: 'ready' },
  { guest_id: 'HM-0006', guest_name: 'Đặng Quốc F', salutation: 'Chú', display_name: 'Chú Đặng Quốc F', guest_group: 'Họ hàng nhà trai', note: '', invitation_status: 'error' },
  { guest_id: 'HM-0007', guest_name: 'Huỳnh Ngọc Phương Anh G', salutation: 'Gia đình', display_name: 'Gia đình Ông Bà Huỳnh Ngọc Phương Anh G', guest_group: 'Đối tác', note: 'Tên dài — kiểm tra xuống dòng', invitation_status: 'ready' },
  { guest_id: 'HM-0008', guest_name: 'Bùi Thanh H', salutation: 'Anh', display_name: 'Anh Bùi Thanh H', guest_group: 'Đồng nghiệp', note: '', invitation_status: 'draft' },
  { guest_id: 'HM-0009', guest_name: 'Ngô Thùy I', salutation: 'Chị', display_name: 'Chị Ngô Thùy I', guest_group: 'Bạn cô dâu', note: '', invitation_status: 'exported' },
  { guest_id: 'HM-0010', guest_name: 'Trương Gia K', salutation: 'Ông', display_name: 'Ông Trương Gia K', guest_group: 'Đối tác', note: '', invitation_status: 'ready' },
];

export const demoGuestPreview = demoGuests[0];

export const guestGroups = ['Họ hàng nhà trai', 'Họ hàng nhà gái', 'Bạn chú rể', 'Bạn cô dâu', 'Đồng nghiệp', 'Đối tác'];

export { salutations } from './salutations';

export const statusMeta: Record<GuestStatus, { label: string; tone: 'neutral' | 'gold' | 'success' | 'danger' }> = {
  draft: { label: 'Chưa tạo', tone: 'neutral' },
  ready: { label: 'Đã tạo', tone: 'gold' },
  exported: { label: 'Đã xuất', tone: 'success' },
  error: { label: 'Cần xử lý', tone: 'danger' },
};

/** Chỉ số minh họa cho dashboard. */
export const demoStats = {
  totalGuests: 248,
  created: 186,
  exported: 152,
  pending: 7,
};

export const demoActivity = [
  { when: '10 phút trước', text: 'Xuất 24 thiệp nhóm “Đồng nghiệp”' },
  { when: 'Hôm qua, 21:40', text: 'Nhập 38 khách từ khach-moi-nha-gai.xlsx' },
  { when: 'Hôm qua, 20:15', text: 'Cập nhật cách xưng hô cho 6 khách' },
  { when: '12/10/2026', text: 'Duyệt mẫu thiệp “Forever Burgundy”' },
];
