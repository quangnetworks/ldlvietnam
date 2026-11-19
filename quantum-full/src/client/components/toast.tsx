import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

type Toast = { id: number; tone: 'success' | 'error' | 'info'; message: string };
const Ctx = createContext<(tone: Toast['tone'], message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, tone, message }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 5000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border border-line bg-surface-2 px-3.5 py-3 text-sm shadow-lg shadow-black/40">
            {t.tone === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 text-danger" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 text-accent" />}
            <span className="flex-1">{t.message}</span>
            <button aria-label="Đóng thông báo" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} className="text-muted hover:text-text">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
