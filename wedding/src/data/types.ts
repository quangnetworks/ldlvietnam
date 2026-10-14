/**
 * Kiểu dữ liệu dùng chung cho cả landing page, thiệp tương tác và thiệp tĩnh.
 * Giai đoạn 2 sẽ tách thành các thực thể lưu trữ thật (WeddingProfile, WeddingEvent,
 * InvitationTemplate, Guest, InvitationInstance, ExportJob).
 */

export type VerificationStatus = 'verified' | 'needs-confirmation';

/** Ghi chú kiểm tra cho một trường dữ liệu — dùng để nhắc người dùng xác nhận. */
export interface DataFlag {
  field: string;
  status: VerificationStatus;
  message: string;
}

export interface Parent {
  title: 'Ông' | 'Bà';
  name: string;
}

export interface Family {
  side: 'groom' | 'bride';
  label: string; // "Nhà trai" / "Nhà gái"
  father: Parent;
  mother: Parent;
  addressLines: string[];
}

export interface Partner {
  fullName: string;
  initial: string;
  role: string; // "Trưởng Nam" / "Trưởng Nữ"
}

export interface WeddingProfile {
  concept: string;
  conceptTagline: string;
  monogram: { left: string; right: string };
  groom: Partner;
  bride: Partner;
  families: { groom: Family; bride: Family };
}

export interface ScheduleItem {
  label: string;
  time: string;
}

export interface WeddingEvent {
  id: 'ceremony' | 'reception';
  /** Tiêu đề đúng như cách ghi trên thiệp tham chiếu. */
  title: string;
  shortTitle: string;
  venueKind: string; // ví dụ "Trung tâm Hội nghị Tiệc cưới" hoặc "Tư gia"
  venueName: string;
  venueHall?: string;
  venueAddressLines: string[];
  /** Ngày dương lịch ISO (yyyy-mm-dd), giữ nguyên theo thiệp tham chiếu. */
  date: string;
  weekday: string;
  time: string;
  schedule: ScheduleItem[];
  /** Âm lịch — giữ nguyên chuỗi như trên thiệp, không tự tính lại. */
  lunarText: string;
}

export type GuestStatus = 'draft' | 'ready' | 'exported' | 'error';

export interface Guest {
  guest_id: string;
  guest_name: string;
  salutation: string;
  display_name: string;
  guest_group: string;
  note: string;
  invitation_status: GuestStatus;
  /** Mã bí mật trong link thiệp riêng (chỉ có với khách đã lưu trên máy chủ). */
  token?: string;
  link_sent_at?: string | null;
  opened_at?: string | null;
  last_opened_at?: string | null;
  open_count?: number;
  created_at?: string;
  updated_at?: string;
}
