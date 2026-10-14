import type { Guest } from '../data/types';
import { reception, wedding } from '../data/wedding';
import { slashDate } from './format';
import { inviteUrl } from './api';

export const messageVariables = [
  { key: 'guest_display_name', label: 'Tên khách trên thiệp' },
  { key: 'groom_name', label: 'Tên chú rể' },
  { key: 'bride_name', label: 'Tên cô dâu' },
  { key: 'wedding_date', label: 'Ngày tiệc cưới' },
  { key: 'lunar_date', label: 'Ngày âm lịch' },
  { key: 'wedding_time', label: 'Giờ đón khách' },
  { key: 'reception_schedule', label: 'Đón khách & khai tiệc' },
  { key: 'venue_name', label: 'Nơi tổ chức' },
  { key: 'venue_address', label: 'Địa chỉ' },
  { key: 'invite_link', label: 'Link thiệp riêng' },
] as const;

export const defaultMessage = [
  'Kính gửi {{guest_display_name}},',
  '',
  'Gia đình chúng tôi trân trọng kính mời đến dự tiệc cưới của {{groom_name}} và {{bride_name}}.',
  '',
  '• Thời gian: {{wedding_date}} — {{reception_schedule}}',
  '  ({{lunar_date}})',
  '• Địa điểm: {{venue_name}}',
  '  {{venue_address}}',
  '',
  'Thiệp mời: {{invite_link}}',
  '',
  'Sự hiện diện của Quý khách là niềm vinh hạnh cho gia đình chúng tôi.',
].join('\n');

/** Đổi khi mẫu mặc định thay đổi, để mẫu cũ lưu trên trình duyệt không che mẫu mới. */
export const MESSAGE_STORAGE_KEY = 'hm.messageTemplate.v2';

export function variablesFor(g: Guest): Record<string, string> {
  return {
    guest_display_name: g.display_name,
    groom_name: wedding.groom.fullName,
    bride_name: wedding.bride.fullName,
    wedding_date: `${reception.weekday}, ${slashDate(reception.date)}`,
    lunar_date: reception.lunarText,
    wedding_time: reception.time,
    reception_schedule: reception.schedule.map((s) => `${s.label.toLowerCase()} ${s.time}`).join(', '),
    venue_name: `${reception.venueKind} ${reception.venueName} — ${reception.venueHall}`,
    venue_address: reception.venueAddressLines.join(' '),
    invite_link: inviteUrl(g),
  };
}

/** Thay biến {{...}}. Trả về cả danh sách biến không thay được để chặn gửi lỗi. */
export function fillTemplate(tpl: string, vars: Record<string, string>) {
  const missing = new Set<string>();
  const text = tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, k: string) => {
    const v = vars[k];
    if (v === undefined || v === null || v === '') {
      missing.add(k);
      return all;
    }
    return v;
  });
  return { text, missing: [...missing] };
}
