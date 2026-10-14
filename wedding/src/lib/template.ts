import type { Guest } from '../data/types';
import { reception, wedding } from '../data/wedding';
import { dotDate } from './format';
import { inviteUrl } from './api';

export const messageVariables = [
  { key: 'guest_display_name', label: 'Tên khách trên thiệp' },
  { key: 'groom_name', label: 'Tên chú rể' },
  { key: 'bride_name', label: 'Tên cô dâu' },
  { key: 'wedding_date', label: 'Ngày tiệc cưới' },
  { key: 'wedding_time', label: 'Giờ tiệc cưới' },
  { key: 'venue_name', label: 'Nơi tổ chức' },
  { key: 'venue_address', label: 'Địa chỉ' },
  { key: 'invite_link', label: 'Link thiệp riêng' },
] as const;

export const defaultMessage =
  'Kính gửi {{guest_display_name}},\n\nGia đình chúng tôi trân trọng kính mời đến dự tiệc cưới của {{groom_name}} & {{bride_name}} lúc {{wedding_time}}, {{wedding_date}} tại {{venue_name}}.\n\nThiệp mời dành riêng cho bạn: {{invite_link}}';

export function variablesFor(g: Guest): Record<string, string> {
  return {
    guest_display_name: g.display_name,
    groom_name: wedding.groom.fullName,
    bride_name: wedding.bride.fullName,
    wedding_date: `${reception.weekday} ${dotDate(reception.date)}`,
    wedding_time: reception.time,
    venue_name: `${reception.venueName} — ${reception.venueHall}`,
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
