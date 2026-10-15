import type { ThemeId } from './themes';
import { copy } from './wedding';

export type SectionId = 'monogram' | 'announce' | 'couple' | 'families' | 'ceremony' | 'guest' | 'reception' | 'thanks';
export type Palette = ThemeId;
export type NameStyle = 'serif' | 'script';

export interface InvitationDesign {
  /** 2: tên cô dâu chú rể mặc định dùng thư pháp Ballet. */
  version?: number;
  templateName: string;
  palette: Palette;
  nameStyle: NameStyle;
  guestNameScale: number;
  sections: Record<SectionId, boolean>;
  text: {
    announce: string;
    announceEvent: string;
    inviteHeading: string;
    inviteLine: string;
    thanks: string;
  };
}

export const sectionMeta: Array<{ id: SectionId; label: string; hint: string; locked?: boolean }> = [
  { id: 'monogram', label: 'Monogram H&M', hint: 'Dấu ép kim đầu thiệp' },
  { id: 'announce', label: 'Tiêu đề lời mời', hint: 'Trân trọng báo tin…' },
  { id: 'couple', label: 'Tên cô dâu & chú rể', hint: 'Trọng tâm thị giác', locked: true },
  { id: 'families', label: 'Gia đình hai bên', hint: 'Nhà trai · Nhà gái' },
  { id: 'ceremony', label: 'Lễ tân hôn', hint: '14:00 · 07.11.2026 · Tư gia' },
  { id: 'guest', label: 'Tên khách mời', hint: 'Vùng cá nhân hóa', locked: true },
  { id: 'reception', label: 'Tiệc cưới & địa điểm', hint: '18:00 · 14.11.2026 · Adora', locked: true },
  { id: 'thanks', label: 'Lời cảm ơn', hint: 'Lời kết cuối thiệp' },
];

export { themes as palettes } from './themes';

export const defaultDesign: InvitationDesign = {
  version: 2,
  templateName: 'Đỏ Rượu Vang',
  palette: 'burgundy',
  nameStyle: 'script',
  guestNameScale: 1,
  sections: { monogram: true, announce: true, couple: true, families: true, ceremony: true, guest: true, reception: true, thanks: true },
  text: { ...copy },
};
