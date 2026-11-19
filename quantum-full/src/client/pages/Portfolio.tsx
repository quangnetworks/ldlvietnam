import { useEffect, useState } from 'react';
import { CheckCircle2, Layers, RefreshCw } from 'lucide-react';
import { apiFetch, ApiClientError } from '../lib/api';
import { useGame } from '../lib/game';
import { useApi } from '../lib/hooks';
import { dateOnly, todayVn, vnd } from '../lib/format';
import { Badge, Balls, Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, Notice, PageHeader, Pagination, Select, Table, Tabs, Td } from '../components/ui';
import { GenerationResult } from '../components/GenerationResult';
import { useToast } from '../components/toast';

const STATUS: Record<string, { label: string; tone: 'default' | 'good' | 'warn' | 'bad' | 'info' }> = {
  draft: { label: 'Nháp', tone: 'default' },
  purchased: { label: 'Đã mua', tone: 'info' },
  evaluated: { label: 'Đã chấm', tone: 'good' },
  cancelled: { label: 'Đã huỷ', tone: 'bad' },
};

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : 'Có lỗi xảy ra');

function Optimizer({ onSaved }: { onSaved: () => void }) {
  const { code, game } = useGame();
  const toast = useToast();
  const settings = useApi<any>('/settings');
  const perDraw = Number(settings.data?.budget_per_draw?.value ?? 100000);
  const price = game?.ticketPrice ?? 10000;
  const [f, setF] = useState({ budget: 100000, tickets: 10, maxOverlap: Math.max(1, (game?.mainPicks ?? 5) - 3), avoidPopular: true, candidates: 200, date: '', seed: '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  useEffect(() => setResult(null), [code]);
  const cost = f.tickets * price;
  const over = cost > f.budget || cost > perDraw;
  const run = async () => {
    setBusy(true);
    try {
      const r = await apiFetch('/portfolio/optimize', {
        body: { game: code, budget: f.budget, ticket_count: f.tickets, target_draw_date: f.date || null, seed: f.seed || null, params: { maxOverlap: f.maxOverlap, avoidPopular: f.avoidPopular, candidates: f.candidates } },
      });
      setResult({ ...r.data, target_draw_date: f.date || null });
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      <Card title="Portfolio Optimizer">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ngân sách (VND)" hint={`Hạn mức/kỳ ${vnd(perDraw)}`}>
              <Input type="number" min={0} step={price} value={f.budget} onChange={(e) => setF({ ...f, budget: Number(e.target.value) })} />
            </Field>
            <Field label="Số vé" hint={`Tối đa ${Math.floor(Math.min(f.budget, perDraw) / price)}`}>
              <Input type="number" min={1} value={f.tickets} onChange={(e) => setF({ ...f, tickets: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Trùng tối đa giữa 2 vé (số chính)">
            <Input type="number" min={0} max={game?.mainPicks ?? 6} value={f.maxOverlap} onChange={(e) => setF({ ...f, maxOverlap: Number(e.target.value) })} />
          </Field>
          <Field label="Số ứng viên đánh giá / vé">
            <Select value={f.candidates} onChange={(e) => setF({ ...f, candidates: Number(e.target.value) })}>
              <option value={100}>100 (nhanh)</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
              <option value={1000}>1.000 (kỹ)</option>
            </Select>
          </Field>
          <label className="flex items-start gap-2 text-xs text-muted">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-500" checked={f.avoidPopular} onChange={(e) => setF({ ...f, avoidPopular: e.target.checked })} />
            Ưu tiên bộ số ít phổ biến (giảm rủi ro phải chia giải; không đổi xác suất trúng)
          </label>
          <Field label="Ngày quay mục tiêu (tuỳ chọn)">
            <Input type="date" min={todayVn()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="Random seed (tuỳ chọn)">
            <Input value={f.seed} onChange={(e) => setF({ ...f, seed: e.target.value })} />
          </Field>
          {over && <Notice tone="bad">Chi phí {vnd(cost)} vượt ngân sách hoặc hạn mức mỗi kỳ.</Notice>}
          <Button variant="primary" className="w-full" loading={busy} disabled={over || f.tickets < 1} onClick={run}>
            <Layers className="h-4 w-4" aria-hidden /> Tối ưu danh mục
          </Button>
          <Notice tone="info">Tối ưu độ phủ giúp các vé ít trùng nhau, KHÔNG làm tăng xác suất trúng của từng tổ hợp. P(Jackpot) của danh mục luôn = số vé khác nhau / tổng tổ hợp.</Notice>
        </div>
      </Card>
      <div className="min-w-0">{result ? <GenerationResult r={result} onSaved={onSaved} /> : <Card><EmptyState title="Chưa có danh mục tối ưu" description="Thiết lập ràng buộc và bấm “Tối ưu danh mục”." /></Card>}</div>
    </div>
  );
}

function PortfolioDetail({ id, onChanged }: { id: number; onChanged: () => void }) {
  const q = useApi<any>(`/portfolios/${id}`);
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const act = async (key: string, path: string, ok: string) => {
    setBusy(key);
    try {
      const r = await apiFetch(path, { body: {} });
      if (r.data?.evaluated === false) toast('error', r.data.reason);
      else toast('success', ok);
      q.reload();
      onChanged();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingBlock />;
  const p = q.data;
  return (
    <div className="space-y-3 rounded-lg border border-line bg-bg/50 p-3">
      <div className="flex flex-wrap gap-2">
        {p.mode === 'real' && p.status === 'draft' && (
          <Button variant="primary" loading={busy === 'buy'} onClick={() => act('buy', `/portfolios/${id}/purchase`, 'Đã ghi nhận mua vé thực tế')}>
            Ghi nhận đã mua ({vnd(p.total_cost)})
          </Button>
        )}
        {(p.status === 'draft' || p.status === 'purchased') && (
          <Button loading={busy === 'eval'} onClick={() => act('eval', `/portfolios/${id}/evaluate`, 'Đã chấm vé')}>
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Chấm với kết quả
          </Button>
        )}
        {p.status === 'draft' && (
          <Button variant="danger" loading={busy === 'cancel'} onClick={() => act('cancel', `/portfolios/${id}/cancel`, 'Đã huỷ danh mục')}>
            Huỷ danh mục
          </Button>
        )}
      </div>
      {p.mode === 'real' && p.status === 'draft' && <Notice tone="info">Hệ thống không mua vé thay bạn. Chỉ bấm “Ghi nhận đã mua” sau khi bạn đã tự mua vé tại điểm bán/kênh chính thức. Hạn mức vốn được kiểm tra trước khi ghi nhận.</Notice>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {p.tickets.map((t: any) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
            <Balls main={t.main} special={t.special} size="sm" />
            {t.result && (
              <span className="ml-auto text-xs">
                {t.result.prizeTier ? <Badge tone="good">{t.result.prizeTier} · {t.result.prizeAmount == null ? 'Jackpot' : vnd(t.result.prizeAmount)}</Badge> : <span className="text-muted">trùng {t.result.mainMatches}{t.result.specialMatched ? ' + ĐB' : ''}</span>}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SavedPortfolios({ refreshKey }: { refreshKey: number }) {
  const { code } = useGame();
  const toast = useToast();
  const [mode, setMode] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useApi<any[]>(`/portfolios?game=${code}&page=${page}&page_size=15${mode ? `&mode=${mode}` : ''}&_=${refreshKey}`);
  const evaluateAll = async () => {
    setBusy(true);
    try {
      const r = await apiFetch('/tracking/evaluate', { body: {} });
      const done = r.data.results.filter((x: any) => x.evaluated).length;
      toast('success', `Đã kiểm tra ${r.data.checked} danh mục, chấm được ${done}`);
      q.reload();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Danh mục đã lưu & theo dõi kỳ quay"
      actions={
        <>
          <Select aria-label="Lọc loại danh mục" value={mode} onChange={(e) => (setMode(e.target.value), setPage(1))} className="w-40">
            <option value="">Tất cả</option>
            <option value="simulated">Mô phỏng</option>
            <option value="real">Thực tế</option>
          </Select>
          <Button loading={busy} onClick={evaluateAll}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Chấm tất cả
          </Button>
        </>
      }
    >
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {q.loading && !q.data && <LoadingBlock />}
      {q.data?.length === 0 && <EmptyState title="Chưa có danh mục" description="Sinh bộ số hoặc tối ưu danh mục, sau đó bấm “Lưu danh mục”." />}
      {!!q.data?.length && (
        <Table head={['#', 'Tên', 'Loại', 'Kỳ mục tiêu', 'Vé', 'Chi phí', 'Giải cố định', 'Trạng thái', '']}>
          {q.data.flatMap((p) => [
            <tr key={p.id}>
              <Td>{p.id}</Td>
              <Td>{p.name}</Td>
              <Td>{p.mode === 'real' ? <Badge tone="warn">Thực tế</Badge> : <Badge>Mô phỏng</Badge>}</Td>
              <Td className="whitespace-nowrap text-xs">
                {dateOnly(p.target_draw_date)} {p.target_draw_time ?? ''}
              </Td>
              <Td className="tabular">{p.ticket_count}</Td>
              <Td className="tabular">{vnd(p.total_cost)}</Td>
              <Td className="tabular">{p.status === 'evaluated' ? vnd(p.fixed_prizes) : '—'}</Td>
              <Td>
                <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
              </Td>
              <Td>
                <Button variant="ghost" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                  {open === p.id ? 'Đóng' : 'Chi tiết'}
                </Button>
              </Td>
            </tr>,
            open === p.id ? (
              <tr key={`${p.id}-d`}>
                <td colSpan={9} className="px-2 pb-3">
                  <PortfolioDetail id={p.id} onChanged={q.reload} />
                </td>
              </tr>
            ) : null,
          ])}
        </Table>
      )}
      <Pagination meta={q.meta as any} onPage={setPage} />
    </Card>
  );
}

export default function Portfolio() {
  const [tab, setTab] = useState<'optimize' | 'saved'>('optimize');
  const [refresh, setRefresh] = useState(0);
  return (
    <>
      <PageHeader title="Danh mục vé" description="Tối ưu độ phủ theo ngân sách, lưu danh mục mô phỏng hoặc thực tế, và chấm vé với kết quả đã xác minh." />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'optimize', label: 'Tối ưu danh mục' }, { value: 'saved', label: 'Danh mục đã lưu' }]} />
      {tab === 'optimize' ? <Optimizer onSaved={() => setRefresh((x) => x + 1)} /> : <SavedPortfolios refreshKey={refresh} />}
    </>
  );
}
