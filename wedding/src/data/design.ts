import { copy } from './wedding';

export type SectionId = 'monogram' | 'announce' | 'couple' | 'families' | 'ceremony' | 'guest' | 'reception' | 'thanks';
export type Palette = 'burgundy' | 'champagne' | 'espresso';
export type NameStyle = 'serif' | 'script';

export interface InvitationDesign {
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

export const palettes: Array<{ id: Palette; name: string; swatch: [string, string, string] }> = [
  { id: 'burgundy', name: 'Forever Burgundy', swatch: ['#fbf7f0', '#4a0e18', '#c9a96e'] },
  { id: 'champagne', name: 'Champagne Ivory', swatch: ['#fbf7f0', '#ede2d0', '#6e1423'] },
  { id: 'espresso', name: 'Espresso Noir', swatch: ['#f5eee2', '#2c1f19', '#e6d3a8'] },
];

export const defaultDesign: InvitationDesign = {
  templateName: 'Forever Burgundy',
  palette: 'burgundy',
  nameStyle: 'serif',
  guestNameScale: 1,
  sections: { monogram: true, announce: true, couple: true, families: true, ceremony: true, guest: true, reception: true, thanks: true },
  text: { ...copy },
};
