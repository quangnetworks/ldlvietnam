import { useEffect, useState } from 'react';
import { apiFetch, ApiClientError } from '../lib/api';
import { num, pct, vnd } from '../lib/format';
import { Badge, Card, Kpi, LoadingBlock, Notice } from './ui';

interface Ticket {
  main: number[];
  special: number | null;
}

const BAR: Record<string, string> = { zero: 'bg-slate-500', below_cost: 'bg-warn', break_even: 'bg-accent', ten_x: 'bg-primary' };

/** Xác suất CHÍNH XÁC của cả danh mục vé trong một kỳ (POST /portfolio/odds). */
export function PortfolioOdds({ game, tickets }: { game: string; tickets: Ticket[] }) {
  const key = JSON.stringify({ game, tickets: tickets.map((t) => ({ main: t.main, special: t.special ?? null })) });
  const [state, setState] = useState<{ key: string; data?: any; error?: string } | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    const body = JSON.parse(key);
    apiFetch('/portfolio/odds', { body, signal: ctrl.signal })
      .then((r) => setState({ key, data: r.data }))
      .catch((e) => {
        if (!ctrl.signal.aborted) setState({ key, error: e instanceof ApiClientError ? e.message : 'Không tính được xác suất danh mục' });
      });
    return () => ctrl.abort();
  }, [key]);
  const cur = state?.key === key ? state : null;
  const d = cur?.data;
  return (
    <Card
      title="Xác suất chính xác của cả danh mục"
      subtitle={d ? (d.method === 'exact' ? `Liệt kê toàn bộ ${num(d.outcomes)} kết quả quay có thể` : `Ước lượng Monte Carlo ${num(d.outcomes)} kỳ mô phỏng (seed cố định)`) : 'Đang tính…'}
      actions={d && <Badge tone={d.method === 'exact' ? 'good' : 'info'}>{d.method === 'exact' ? 'Chính xác' : 'Monte Carlo'}</Badge>}
    >
      {!cur && <LoadingBlock rows={3} />}
      {cur?.error && <Notice tone="warn">{cur.error}</Notice>}
      {d && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="P(có ≥ 1 vé trúng)"
              value={pct(d.pAnyPrize, 2)}
              tone={d.pAnyPrize > d.pAnyPrizeIndependent + 1e-9 ? 'good' : 'default'}
              hint={`Chọn ngẫu nhiên độc lập: ${pct(d.pAnyPrizeIndependent, 2)}`}
            />
            <Kpi label="P(tiền thưởng ≥ chi phí)" value={pct(d.pBreakEven, 2)} hint={`Chi phí ${vnd(d.cost)}`} />
            <Kpi label="Tiền thưởng kỳ vọng" value={vnd(d.expectedPayout)} hint={`Hoàn vốn ${pct(d.returnRatio, 1)}`} />
            <Kpi label="Lỗ kỳ vọng" value={vnd(d.cost - d.expectedPayout)} tone="warn" hint="Không đổi dù chọn số thế nào" />
          </div>
          <div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label="Phân phối kết quả của danh mục">
              {d.buckets.map((b: any) => (
                <div key={b.code} className={BAR[b.code]} style={{ width: `${Math.max(0, b.probability) * 100}%` }} title={`${b.label}: ${pct(b.probability, 3)}`} />
              ))}
            </div>
            <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
              {d.buckets.map((b: any) => (
                <li key={b.code} className="flex items-center gap-2">
                  <span className={`inline-block h-2.5 w-2.5 rounded-sm ${BAR[b.code]}`} aria-hidden />
                  <span className="text-muted">{b.label}</span>
                  <span className="tabular ml-auto">{pct(b.probability, 3)}</span>
                </li>
              ))}
            </ul>
          </div>
          {d.ci95 && (
            <p className="text-xs text-muted">
              Khoảng tin cậy 95% của P(có ≥ 1 vé trúng): {pct(d.ci95.low, 2)} – {pct(d.ci95.high, 2)}.
            </p>
          )}
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
            {d.notes.map((n: string) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
