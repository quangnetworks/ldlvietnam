import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { apiFetch, ApiClientError } from '../lib/api';
import { useGame } from '../lib/game';
import { useApi } from '../lib/hooks';
import { dateTime, todayVn, vnd } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, Notice, PageHeader, Pagination, Select, Table, Td } from '../components/ui';
import { GenerationResult } from '../components/GenerationResult';
import { useToast } from '../components/toast';

export const STRATEGY_LABEL: Record<string, string> = {
  random_uniform: 'Ngẫu nhiên đồng đều',
  balanced: 'Cân bằng',
  statistical: 'Nghiên cứu thống kê',
  bayesian: 'Thực nghiệm Bayes',
  portfolio_optimized: 'Tối ưu danh mục',
};

export default function Generator() {
  const { code, game } = useGame();
  const toast = useToast();
  const settings = useApi<any>('/settings');
  const perDraw = Number(settings.data?.budget_per_draw?.value ?? 100000);
  const price = game?.ticketPrice ?? 10000;
  const [f, setF] = useState({ strategy: 'random_uniform', budget: 100000, tickets: 10, date: '', seed: '', unverified: false, window: 100, priorStrength: 100 });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [page, setPage] = useState(1);
  const history = useApi<any[]>(code ? `/recommendations?game=${code}&page=${page}&page_size=10` : null);
  useEffect(() => setResult(null), [code]);
  useEffect(() => {
    if (settings.data) setF((x) => ({ ...x, budget: Math.min(x.budget, perDraw) }));
  }, [settings.data, perDraw]);
  const maxTickets = Math.max(0, Math.floor(Math.min(f.budget, perDraw) / price));
  const overBudget = f.tickets * price > f.budget || f.tickets * price > perDraw;

  const generate = async () => {
    setBusy(true);
    try {
      const params = f.strategy === 'statistical' ? { window: f.window } : f.strategy === 'bayesian' ? { priorStrength: f.priorStrength } : undefined;
      const r = await apiFetch('/generator/generate', {
        body: { game: code, strategy: f.strategy, budget: f.budget, ticket_count: f.tickets, target_draw_date: f.date || null, seed: f.seed || null, include_unverified: f.unverified, params },
      });
      setResult({ ...r.data, target_draw_date: f.date || null });
      history.reload();
    } catch (e) {
      toast('error', e instanceof ApiClientError ? e.message : 'Không sinh được bộ số');
    } finally {
      setBusy(false);
    }
  };

  const loadOld = async (id: number) => {
    try {
      const r = await apiFetch(`/recommendations/${id}`);
      const d = r.data;
      toast('info', `Bộ số #${id}: ${d.tickets.length} vé, ${STRATEGY_LABEL[d.strategy_code]}`);
      setResult(null);
      setTimeout(
        () =>
          setResult({
            recommendationId: d.id,
            createdAt: d.created_at,
            seed: d.seed,
            tickets: d.tickets.map((t: any) => ({ ...t, popularity: 0 })),
            totalCost: d.total_cost,
            coverage: d.metrics.coverage,
            probability: d.metrics.probability,
            explanation: 'Bản ghi lịch sử (bất biến). Xem chi tiết thuật toán tại Kiểm toán mô hình.',
            algorithm: { code: d.strategy_code, name: STRATEGY_LABEL[d.strategy_code], version: d.algorithm_version, baseline: d.strategy_code === 'random_uniform' },
            dataCutoff: { lastDrawAt: d.data_cutoff_at, drawCount: d.data_draw_count, before: d.target_draw_date ? `${d.target_draw_date}T00:00:00+07:00` : null, includeUnverified: false },
            datasetHash: d.metrics.datasetHash ?? '',
            validationStatus: d.validation_status,
            disclaimer: 'Mọi tổ hợp có cùng xác suất trúng. Không có bảo đảm trúng thưởng.',
            target_draw_date: d.target_draw_date,
          }),
        0,
      );
    } catch (e) {
      toast('error', e instanceof ApiClientError ? e.message : 'Không tải được');
    }
  };

  return (
    <>
      <PageHeader title="Number Generator" description="Sinh bộ số theo chiến lược có kiểm toán: mỗi lần sinh lưu seed, phiên bản thuật toán, mốc dữ liệu và không thể chỉnh sửa." />
      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <Card title="Thiết lập">
          <div className="space-y-3">
            <Field label="Trò chơi">
              <Input value={game?.name ?? ''} readOnly />
            </Field>
            <Field label="Chiến lược">
              <Select value={f.strategy} onChange={(e) => setF({ ...f, strategy: e.target.value })}>
                {Object.entries(STRATEGY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            {f.strategy === 'statistical' && (
              <Field label="Cửa sổ tần suất (kỳ)">
                <Input type="number" min={5} max={1000} value={f.window} onChange={(e) => setF({ ...f, window: Number(e.target.value) })} />
              </Field>
            )}
            {f.strategy === 'bayesian' && (
              <Field label="Độ mạnh prior đồng đều" hint="Lớn hơn ⇒ posterior gần đồng đều hơn.">
                <Input type="number" min={1} value={f.priorStrength} onChange={(e) => setF({ ...f, priorStrength: Number(e.target.value) })} />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ngân sách (VND)" hint={`Hạn mức/kỳ: ${vnd(perDraw)}`}>
                <Input type="number" min={0} step={price} max={perDraw} value={f.budget} onChange={(e) => setF({ ...f, budget: Number(e.target.value) })} />
              </Field>
              <Field label="Số vé" hint={`Tối đa ${maxTickets}`}>
                <Input type="number" min={1} max={Math.max(1, maxTickets)} value={f.tickets} onChange={(e) => setF({ ...f, tickets: Number(e.target.value) })} />
              </Field>
            </div>
            <Field label="Ngày quay mục tiêu (tuỳ chọn)" hint="Chỉ dùng dữ liệu trước ngày này.">
              <Input type="date" min={todayVn()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            </Field>
            <Field label="Random seed (tuỳ chọn)" hint="Để trống: hệ thống tạo seed ngẫu nhiên và lưu lại.">
              <Input value={f.seed} onChange={(e) => setF({ ...f, seed: e.target.value })} placeholder="vd: ky-1234" />
            </Field>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" className="h-4 w-4 accent-accent" checked={f.unverified} onChange={(e) => setF({ ...f, unverified: e.target.checked })} />
              Dùng cả dữ liệu chưa xác minh
            </label>
            {overBudget && <Notice tone="bad">Tổng chi phí {vnd(f.tickets * price)} vượt ngân sách hoặc hạn mức mỗi kỳ.</Notice>}
            <Button variant="primary" className="w-full" loading={busy} disabled={overBudget || f.tickets < 1 || !code} onClick={generate}>
              <Sparkles className="h-4 w-4" aria-hidden /> Sinh bộ số
            </Button>
          </div>
        </Card>
        <div className="min-w-0">
          {result ? (
            <GenerationResult r={result} />
          ) : (
            <Card>
              <EmptyState title="Chưa có bộ số" description="Chọn chiến lược, ngân sách và bấm “Sinh bộ số”. Mọi chiến lược đều có xác suất trúng như nhau cho mỗi tổ hợp — khác biệt nằm ở độ phủ và mức phổ biến." />
            </Card>
          )}
        </div>
      </div>
      <Card title="Lịch sử sinh số" className="mt-5">
        {history.error && <ErrorState error={history.error} onRetry={history.reload} />}
        {history.loading && !history.data && <LoadingBlock />}
        {history.data?.length === 0 && <EmptyState title="Chưa có lịch sử" />}
        {!!history.data?.length && (
          <Table head={['#', 'Thời điểm', 'Chiến lược', 'Số vé', 'Chi phí', 'Kỳ mục tiêu', 'Kiểm định', '']}>
            {history.data.map((h) => (
              <tr key={h.id}>
                <Td>{h.id}</Td>
                <Td className="whitespace-nowrap text-xs text-muted">{dateTime(h.created_at)}</Td>
                <Td>
                  {STRATEGY_LABEL[h.strategy_code] ?? h.strategy_code} <span className="text-xs text-muted">v{h.algorithm_version}</span>
                </Td>
                <Td className="measured">{h.ticket_count}</Td>
                <Td className="measured">{vnd(h.total_cost)}</Td>
                <Td className="text-xs">{h.target_draw_date ?? '—'}</Td>
                <Td className="max-w-[220px] text-xs">{h.strategy_code === 'random_uniform' ? <Badge tone="info">Baseline</Badge> : <span className="text-muted">{h.validation_status}</span>}</Td>
                <Td>
                  <Button variant="ghost" onClick={() => loadOld(h.id)}>
                    Xem
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination meta={history.meta as any} onPage={setPage} />
      </Card>
      {!game && settings.loading && <LoadingBlock />}
    </>
  );
}
