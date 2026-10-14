import { createContext, useContext, useState, type ReactNode } from 'react';
import { defaultDesign, type InvitationDesign } from '../../data/design';
import { demoGuests } from '../../data/demo';
import type { Guest } from '../../data/types';

/**
 * Trạng thái tạm thời của Studio trong giai đoạn UI.
 * Chỉ nằm trong bộ nhớ của tab trình duyệt — tải lại trang sẽ trở về dữ liệu minh họa.
 */
interface StudioState {
  guests: Guest[];
  setGuests: React.Dispatch<React.SetStateAction<Guest[]>>;
  design: InvitationDesign;
  setDesign: React.Dispatch<React.SetStateAction<InvitationDesign>>;
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
}

const Ctx = createContext<StudioState | null>(null);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [guests, setGuests] = useState<Guest[]>(demoGuests);
  const [design, setDesign] = useState<InvitationDesign>(defaultDesign);
  const [selected, setSelected] = useState<string[]>(demoGuests.slice(0, 6).map((g) => g.guest_id));
  return <Ctx.Provider value={{ guests, setGuests, design, setDesign, selected, setSelected }}>{children}</Ctx.Provider>;
}

export function useStudio() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStudio must be used inside StudioProvider');
  return v;
}
