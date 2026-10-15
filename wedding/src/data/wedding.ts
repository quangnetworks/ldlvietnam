import type { DataFlag, WeddingEvent, WeddingProfile } from './types';

/**
 * NGUỒN DỮ LIỆU CHUẨN — chép nguyên văn từ thiệp tham chiếu.
 * Mọi màn hình (landing, thiệp tương tác, thiệp tĩnh, studio) đều đọc từ đây.
 * Không tự ý sửa hay đồng bộ ngày giữa hai sự kiện.
 */
export const wedding: WeddingProfile = {
  concept: 'The Art of Forever',
  conceptTagline: 'H&M Wedding',
  monogram: { left: 'H', right: 'M' },
  groom: { fullName: 'Trần Minh Huy', initial: 'H', role: 'Trưởng Nam' },
  bride: { fullName: 'Tiêu Bảo Muội', initial: 'M', role: 'Trưởng Nữ' },
  families: {
    groom: {
      side: 'groom',
      label: 'Nhà trai',
      father: { title: 'Ông', name: 'Trần Duy Hưng' },
      mother: { title: 'Bà', name: 'Trần Thị Đan' },
      addressLines: ['21/5A Xô Viết Nghệ Tĩnh,', 'Phường Gia Định, TP. Hồ Chí Minh'],
    },
    bride: {
      side: 'bride',
      label: 'Nhà gái',
      father: { title: 'Ông', name: 'Huỳnh Minh Chiến' },
      mother: { title: 'Bà', name: 'Nguyễn Ngọc Diệu' },
      addressLines: ['Ấp Nông Trường,', 'Xã Sông Đốc, Tỉnh Cà Mau'],
    },
  },
};

export const ceremony: WeddingEvent = {
  id: 'ceremony',
  title: 'Lễ Tân Hôn',
  shortTitle: 'Lễ tân hôn',
  venueKind: 'Hôn lễ được cử hành tại',
  venueName: 'Tư gia',
  venueAddressLines: [],
  date: '2026-11-07',
  weekday: 'Thứ Bảy',
  time: '14:00',
  schedule: [{ label: 'Cử hành hôn lễ', time: '14:00' }],
  lunarText: 'Nhằm ngày 29 tháng 09 năm Bính Ngọ',
};

export const reception: WeddingEvent = {
  id: 'reception',
  title: 'Tiệc Cưới',
  shortTitle: 'Tiệc cưới',
  venueKind: 'Trung tâm Hội nghị Tiệc cưới',
  venueName: 'Adora Luxury',
  venueHall: 'Sảnh Diamond (Tầng 3)',
  venueAddressLines: ['198 Đường Hoàng Văn Thụ,', 'Phường Đức Nhuận, TP. Hồ Chí Minh'],
  date: '2026-11-14',
  weekday: 'Thứ Bảy',
  time: '18:00',
  schedule: [
    { label: 'Đón khách', time: '18:00' },
    { label: 'Khai tiệc', time: '19:00' },
  ],
  lunarText: 'Nhằm ngày 06 tháng 10 năm Bính Ngọ',
};

export const events = [ceremony, reception] as const;

export const copy = {
  announce: 'Trân trọng báo tin',
  announceEvent: 'Lễ tân hôn của con chúng tôi',
  inviteHeading: 'Trân trọng kính mời',
  inviteLine: 'Đến dự buổi tiệc chung vui cùng gia đình chúng tôi tại',
  /** {{xung_ho}} được thay bằng cách xưng hô của từng khách (Anh, Ông Bà, Gia đình Anh Chị…). */
  thanks: 'Sự hiện diện của {{xung_ho}} là niềm vinh hạnh cho gia đình chúng tôi',
  /** Dùng cho khách nhỏ tuổi hơn: Em, Cháu, Con… */
  thanksYoung: 'Sự có mặt của {{xung_ho}} là niềm vui của gia đình chúng tôi',
};

/**
 * Kết quả đối chiếu dữ liệu với thiệp tham chiếu.
 * "needs-confirmation" = chưa đủ căn cứ, cần chủ tiệc xác nhận trước khi in / xuất.
 */
export const dataFlags: DataFlag[] = [
  {
    field: 'Ngày & thứ',
    status: 'verified',
    message: '07/11/2026 và 14/11/2026 đều rơi vào Thứ Bảy — khớp với thiệp.',
  },
  {
    field: 'Âm lịch',
    status: 'verified',
    message:
      '07/11/2026 ↔ 29/09 Bính Ngọ và 14/11/2026 ↔ 06/10 Bính Ngọ — khớp khi đối chiếu lịch âm. Vẫn giữ nguyên chuỗi chữ in trên thiệp.',
  },
  {
    field: 'Địa điểm lễ tân hôn',
    status: 'verified',
    message: 'Giữ nguyên cách ghi trên thiệp: "Hôn lễ được cử hành tại tư gia".',
  },
  {
    field: 'Giờ trên thiệp tiệc cưới',
    status: 'verified',
    message: 'Thiệp ghi "Vào lúc 18:00", đồng thời ghi Đón khách 18:00 · Khai tiệc 19:00 — đã giữ cả hai mốc.',
  },
];
