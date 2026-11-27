import { useEffect, useRef, useState, type ReactNode } from 'react';
import { apiFetch } from '../lib/api';
import { NavLink, useLocation } from 'react-router-dom';
import { BarChart3, Brain, CalendarCheck, Database, Dices, FlaskConical, Layers, LayoutDashboard, Menu, Microscope, Settings, ShieldCheck, Sparkles, Ticket, Wallet, X } from 'lucide-react';
import { useGame } from '../lib/game';
import { useApi } from '../lib/hooks';
import { Badge, Select, cx } from './ui';

export const NAV = [
  { to: '/', label: 'Tổng quan', icon: LayoutDashboard },
  { to: '/today', label: 'Quyết định hôm nay', icon: CalendarCheck },
  { to: '/bingo18', label: 'Bingo18', icon: Dices },
  { to: '/xskt', label: 'Xổ số kiến thiết', icon: Ticket },
  { to: '/data', label: 'Data Center', icon: Database },
  { to: '/statistics', label: 'Thống kê', icon: BarChart3 },
  { to: '/predictability', label: 'Kiểm định dự đoán', icon: Microscope },
  { to: '/research', label: 'AI Research', icon: Brain },
  { to: '/generator', label: 'Sinh bộ số', icon: Sparkles },
  { to: '/portfolio', label: 'Danh mục vé', icon: Layers },
  { to: '/backtesting', label: 'Backtesting', icon: FlaskConical },
  { to: '/capital', label: 'Kiểm soát vốn', icon: Wallet },
  { to: '/audit', label: 'Kiểm toán mô hình', icon: ShieldCheck },
  { to: '/settings', label: 'Cài đặt', icon: Settings },
];

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Điều hướng chính" className="flex flex-col gap-px">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cx(
              'flex items-center gap-3 rounded-[var(--radius-pill)] border px-3 py-2 text-sm transition-[background-color,color,border-color] duration-[var(--dur-micro)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
              isActive ? 'border-accent/30 bg-accent-soft text-ink' : 'border-transparent text-muted hover:bg-paper-2 hover:text-ink active:bg-paper',
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

/** The wordmark alone: a name and what it is, in the body face. */
function Brand() {
  return (
    <div className="px-3">
      <div className="text-base font-medium tracking-[var(--tracking-display)] text-ink">Quantum Full</div>
      <div className="mt-0.5 text-xs text-muted">Phân tích xác suất xổ số</div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { games, game, setCode, error } = useGame();
  const me = useApi<{ id: string; role: string; method: string }>('/me');
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  // Chế độ chạy cục bộ (không có Cron): tự đồng bộ dữ liệu nguồn mở khi mở app nếu lần cuối đã quá 60 phút.
  const synced = useRef(false);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    if (synced.current || me.data?.method !== 'dev' || me.data.role !== 'admin') return;
    synced.current = true;
    (async () => {
      try {
        const h = (await (await fetch('/api/v1/health')).json()) as { lastSyncAt: string | null };
        if (h.lastSyncAt && Date.now() - new Date(h.lastSyncAt).getTime() < 60 * 60_000) return;
        setSyncing(true);
        await apiFetch('/admin/sync', { body: {} });
      } catch {
        /* bỏ qua: người dùng vẫn có thể bấm "Đồng bộ ngay" */
      } finally {
        setSyncing(false);
      }
    })();
  }, [me.data]);
  const unauthorized = (error as { status?: number } | null)?.status === 401 && loc.pathname !== '/settings';
  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col gap-7 border-r border-rule bg-paper-3 px-3 py-6 lg:flex">
        <Brand />
        <SideNav />
        <p className="mt-auto px-3 text-[11px] leading-relaxed text-muted">Toán học trung thực hơn dự báo sai. Không có hệ thống nào bảo đảm trúng thưởng.</p>
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-paper-3/80" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col gap-6 overflow-y-auto border-r border-rule bg-paper-3 px-3 py-5">
            <div className="flex items-center justify-between">
              <Brand />
              <button aria-label="Đóng menu" onClick={() => setOpen(false)} className="rounded-[var(--radius-pill)] p-1.5 text-muted transition-[color] duration-[var(--dur-micro)] hover:text-ink focus-visible:outline-2 focus-visible:outline-focus active:text-accent">
                <X className="h-5 w-5" />
              </button>
            </div>
            <SideNav onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-rule bg-paper px-4 sm:px-6">
        <button aria-label="Mở menu" className="rounded-[var(--radius-pill)] p-1.5 text-muted transition-[color] duration-[var(--dur-micro)] hover:text-ink focus-visible:outline-2 focus-visible:outline-focus active:text-accent lg:hidden" onClick={() => setOpen(true)}>
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 sm:w-48 sm:flex-none">
          <Select aria-label="Chọn trò chơi" value={game?.code ?? ''} onChange={(e) => setCode(e.target.value)} disabled={!games.length}>
            {games.map((g) => (
              <option key={g.code} value={g.code}>
                {g.name}
              </option>
            ))}
          </Select>
        </div>
        {game && game.rulesVerificationStatus !== 'verified' && (
          <span className="hidden sm:inline">
            <Badge tone="warn">Thể lệ chưa xác minh</Badge>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted">
          {syncing && <Badge tone="info">Đang đồng bộ dữ liệu…</Badge>}
          {me.data?.method === 'dev' && (
            <span className="hidden sm:inline">
              <Badge>Chạy cục bộ</Badge>
            </span>
          )}
          {me.data && (
            <>
              <span className="measured hidden max-w-[180px] truncate sm:inline">{me.data.id}</span>
              <Badge tone={me.data.role === 'admin' ? 'warn' : 'default'}>{me.data.role === 'admin' ? 'Quản trị' : 'Chỉ xem'}</Badge>
            </>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-[1280px] px-4 py-7 sm:px-8">
        {unauthorized ? (
          <div className="mx-auto max-w-lg rounded-[var(--radius-card)] border border-rule bg-paper-2 p-6 text-sm">
            <h1 className="text-lg font-medium">Cần đăng nhập</h1>
            <p className="mt-2 text-muted">
              Ứng dụng được bảo vệ bởi Cloudflare Access. Hãy đăng nhập qua Access, hoặc nhập API token tại mục{' '}
              <NavLink className="text-ink underline decoration-rule-2 underline-offset-4 transition-[color] duration-[var(--dur-micro)] hover:text-accent" to="/settings">
                Cài đặt
              </NavLink>
              .
            </p>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
