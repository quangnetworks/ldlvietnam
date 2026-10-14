import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

type Kind = 'success' | 'info' | 'warning';
interface ToastItem {
  id: number;
  kind: Kind;
  title: string;
  body?: string;
}

const Ctx = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => {});

export function useToast() {
  return useContext(Ctx);
}

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = (id: number) => setItems((s) => s.filter((t) => t.id !== id));
  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = ++seq;
    setItems((s) => [...s.slice(-2), { ...t, id }]);
    setTimeout(() => dismiss(id), 4200);
  }, []);
  const icons = {
    success: <CheckCircle2 className="size-4 text-[#3d5a3a]" />,
    info: <Info className="size-4 text-champagne-deep" />,
    warning: <TriangleAlert className="size-4 text-burgundy-600" />,
  };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end">
        {items.map((t) => (
          <div
            key={t.id}
            className="animate-toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-espresso/8 bg-ivory/95 px-4 py-3 shadow-[0_18px_40px_-18px_rgba(59,42,34,0.45)] backdrop-blur"
          >
            <span className="mt-0.5">{icons[t.kind]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-espresso">{t.title}</p>
              {t.body && <p className="mt-0.5 text-[12.5px] leading-relaxed text-espresso-soft">{t.body}</p>}
            </div>
            <button aria-label="Đóng" onClick={() => dismiss(t.id)} className="-mr-1 rounded-full p-1 text-espresso-soft hover:bg-beige">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
