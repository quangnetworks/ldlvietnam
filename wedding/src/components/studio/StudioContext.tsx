import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { defaultDesign, type InvitationDesign } from '../../data/design';
import type { Guest } from '../../data/types';
import { api } from '../../lib/api';

/**
 * Trạng thái Studio — đồng bộ với máy chủ (Cloudflare Durable Object).
 * Khách mời được ghi ngay khi thêm/sửa; thiết kế lưu khi bấm "Lưu thiết kế".
 */
interface StudioState {
  guests: Guest[];
  upsertGuests: (list: Guest[]) => void;
  removeGuests: (ids: string[]) => void;
  reload: () => Promise<void>;
  design: InvitationDesign;
  setDesign: React.Dispatch<React.SetStateAction<InvitationDesign>>;
  savedDesign: InvitationDesign;
  saveDesign: () => Promise<void>;
  dirty: boolean;
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  logout: () => Promise<void>;
}

const Ctx = createContext<StudioState | null>(null);

/** Bổ sung trường còn thiếu khi thiết kế đã lưu từ phiên bản cũ. */
export function normalizeDesign(d: Partial<InvitationDesign> | null | undefined): InvitationDesign {
  if (!d) return defaultDesign;
  return {
    ...defaultDesign,
    ...d,
    // Thiết kế lưu trước phiên bản 2 chuyển sang tên thư pháp.
    ...((d.version ?? 1) < 2 ? { version: 2, nameStyle: 'script' as const } : {}),
    sections: { ...defaultDesign.sections, ...(d.sections ?? {}) },
    text: { ...defaultDesign.text, ...(d.text ?? {}) },
  };
}

export function StudioProvider({ children, onLoggedOut }: { children: ReactNode; onLoggedOut: () => void }) {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [design, setDesign] = useState<InvitationDesign>(defaultDesign);
  const [savedDesign, setSavedDesign] = useState<InvitationDesign>(defaultDesign);
  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const s = await api.state();
      const d = normalizeDesign(s.design);
      setGuests(s.guests);
      setDesign(d);
      setSavedDesign(d);
      setSelected((sel) => (sel.length ? sel.filter((id) => s.guests.some((g) => g.guest_id === id)) : s.guests.map((g) => g.guest_id)));
      setLoaded(true);
      setError('');
    } catch (e) {
      if ((e as { status?: number }).status === 401) onLoggedOut();
      else setError((e as Error).message);
    }
  }, [onLoggedOut]);

  useEffect(() => {
    reload();
  }, [reload]);

  const upsertGuests = useCallback((list: Guest[]) => {
    setGuests((cur) => {
      const map = new Map(cur.map((g) => [g.guest_id, g]));
      for (const g of list) map.set(g.guest_id, g);
      return [...map.values()];
    });
  }, []);
  const removeGuests = useCallback((ids: string[]) => {
    setGuests((cur) => cur.filter((g) => !ids.includes(g.guest_id)));
    setSelected((cur) => cur.filter((id) => !ids.includes(id)));
  }, []);

  const saveDesign = useCallback(async () => {
    await api.saveDesign(design);
    setSavedDesign(design);
  }, [design]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    onLoggedOut();
  }, [onLoggedOut]);

  if (!loaded) {
    return (
      <div className="grid min-h-[60dvh] place-items-center px-6 text-center">
        {error ? (
          <div>
            <p className="font-serif text-[24px] text-burgundy-800">Không tải được dữ liệu</p>
            <p className="mt-2 text-[14px] text-espresso-soft">{error}</p>
            <button onClick={reload} className="mt-4 text-[14px] font-medium text-burgundy-700 underline">
              Thử lại
            </button>
          </div>
        ) : (
          <p className="eyebrow animate-pulse text-champagne-deep">Đang tải dữ liệu…</p>
        )}
      </div>
    );
  }

  const dirty = JSON.stringify(design) !== JSON.stringify(savedDesign);
  return (
    <Ctx.Provider value={{ guests, upsertGuests, removeGuests, reload, design, setDesign, savedDesign, saveDesign, dirty, selected, setSelected, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStudio() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStudio must be used inside StudioProvider');
  return v;
}
