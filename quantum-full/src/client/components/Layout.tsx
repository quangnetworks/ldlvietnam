import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Activity, BarChart3, Brain, CalendarCheck, Database, Dices, FlaskConical, Layers, LayoutDashboard, Menu, Settings, ShieldCheck, Sparkles, Wallet, X } from 'lucide-react';
import { useGame } from '../lib/game';
import { useApi } from '../lib/hooks';
import { Badge, Select, cx } from './ui';

export const NAV = [
  { to: '/', label: 'Tổng quan', icon: LayoutDashboard },
  { to: '/today', label: 'Quyết định hôm nay', icon: CalendarCheck },
  { to: '/bingo18', label: 'Bingo18', icon: Dices },
  { to: '/data', label: 'Data Center', icon: Database },
  { to: '/statistics', label: 'Thống kê', icon: BarChart3 },
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
    <nav aria-label="Điều hướng chính" className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors', isActive ? 'bg-primary/15 text-blue-100' : 'text-muted hover:bg-surface-2 hover:text-text')}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Activity className="h-4 w-4" aria-hidden />
      </div>
      <div>
        <div className="text-sm font-bold tracking-wide">QUANTUM FULL</div>
        <div className="text-[10px] uppercase tracking-wider text-muted">Lottery Intelligence</div>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { games, game, setCode, error } = useGame();
  const me = useApi<{ id: string; role: string; method: string }>('/me');
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const unauthorized = (error as { status?: number } | null)?.status === 401 && loc.pathname !== '/settings';
  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col gap-6 border-r border-line bg-[#0b1222] px-3 py-5 lg:flex">
        <Brand />
        <SideNav />
        <div className="mt-auto px-2 text-[11px] leading-relaxed text-muted">Toán học trung thực hơn dự báo sai. Không có hệ thống nào bảo đảm trúng thưởng.</div>
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col gap-6 border-r border-line bg-[#0b1222] px-3 py-5">
            <div className="flex items-center justify-between">
              <Brand />
              <button aria-label="Đóng menu" onClick={() => setOpen(false)} className="rounded-md p-1 text-muted hover:text-text">
                <X className="h-5 w-5" />
              </button>
            </div>
            <SideNav onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/95 px-4 backdrop-blur sm:px-6">
        <button aria-label="Mở menu" className="rounded-md p-1.5 text-muted hover:text-text lg:hidden" onClick={() => setOpen(true)}>
          <Menu className="h-5 w-5" />
        </button>
        <div className="w-40 sm:w-48">
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
          {me.data && (
            <>
              <span className="hidden max-w-[180px] truncate sm:inline">{me.data.id}</span>
              <Badge tone={me.data.role === 'admin' ? 'info' : 'default'}>{me.data.role === 'admin' ? 'Quản trị' : 'Chỉ xem'}</Badge>
            </>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {unauthorized ? (
          <div className="mx-auto max-w-lg rounded-xl border border-line bg-surface p-6 text-sm">
            <h1 className="text-lg font-semibold">Cần đăng nhập</h1>
            <p className="mt-2 text-muted">
              Ứng dụng được bảo vệ bởi Cloudflare Access. Hãy đăng nhập qua Access, hoặc nhập API token tại mục{' '}
              <NavLink className="text-primary underline" to="/settings">
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
