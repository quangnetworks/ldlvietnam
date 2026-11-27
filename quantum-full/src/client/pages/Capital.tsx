import { useMemo, useState } from 'react';
import { apiFetch, ApiClientError } from '../lib/api';
import { useApi } from '../lib/hooks';
import { dateOnly, dateTime, pct, todayVn, vnd } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Kpi, LoadingBlock, PageHeader, Pagination, Select, Table, Tabs, Td } from '../components/ui';
import { Chart, CHART, axis } from '../components/Chart';
import { useToast } from '../components/toast';

export default function Capital() {
  const toast = useToast();
  const [mode, setMode] = useState<'real' | 'simulated'>('real');
  const [page, setPage] = useState(1);
  const s = useApi<any>(`/capital/summary?mode=${mode}`);
  const ledger = useApi<any[]>(`/capital/ledger?mode=${mode}&page=${page}&page_size=20`);
  const [f, setF] = useState({ entry_type: 'prize', amount: '', entry_date: todayVn(), portfolio_id: '', note: '' });
  const [busy, setBusy] = useState(false);
  const d = s.data;
  const opt = useMemo(
    () =>
      d && {
        legend: { data: ['Chi mua vé', 'Tiền thưởng', 'Ròng'], textStyle: { color: CHART.muted } },
        xAxis: { type: 'category', data: d.monthly.map((m: any) => m.month), ...axis() },
        yAxis: { type: 'value', ...axis({ axisLabel: { color: CHART.muted, formatter: (v: number) => `${(v / 1000).toLocaleString('vi-VN')}k` } }) },
        series: [
          { name: 'Chi mua vé', type: 'bar', data: d.monthly.map((m: any) => m.investment), itemStyle: { color: CHART.faint } },
          { name: 'Tiền thưởng', type: 'bar', data: d.monthly.map((m: any) => m.prizes), itemStyle: { color: CHART.accent } },
          { name: 'Ròng', type: 'line', data: d.monthly.map((m: any) => m.net), itemStyle: { color: CHART.warn } },
        ],
      },
    [d],
  );
  const add = async () => {
    setBusy(true);
    try {
      await apiFetch('/capital/ledger', { body: { entry_type: f.entry_type, mode, amount: Number(f.amount), entry_date: f.entry_date, portfolio_id: f.portfolio_id ? Number(f.portfolio_id) : null, note: f.note } });
      toast('success', 'Đã ghi bút toán');
      setF({ ...f, amount: '', note: '' });
      s.reload();
      ledger.reload();
    } catch (e) {
      toast('error', e instanceof ApiClientError ? e.message : 'Không ghi được');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="Kiểm soát vốn" description="Ngân sách cố định, không Martingale, không tự động mua vé. Giao dịch thực tế và mô phỏng được tách biệt hoàn toàn." />
      <Tabs value={mode} onChange={(m) => (setMode(m), setPage(1))} items={[{ value: 'real', label: 'Thực tế' }, { value: 'simulated', label: 'Mô phỏng' }]} />
      {s.error && <ErrorState error={s.error} onRetry={s.reload} />}
      {!d && !s.error && <LoadingBlock rows={6} />}
      {d && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Tổng đầu tư" value={vnd(d.totalInvestment)} hint={`${d.drawsPlayed} kỳ đã chơi`} />
            <Kpi label="Tổng tiền thưởng" value={vnd(d.totalPrizes)} hint={d.adjustments ? `Điều chỉnh: ${vnd(d.adjustments)}` : undefined} />
            <Kpi label="Kết quả ròng" value={vnd(d.netResult)} tone={d.netResult >= 0 ? 'good' : 'bad'} />
            <Kpi label="ROI" value={d.roi == null ? '—' : pct(d.roi, 1)} tone={d.roi != null && d.roi < 0 ? 'bad' : 'default'} />
            <Kpi label="Chi phí TB mỗi kỳ" value={vnd(d.costPerDraw)} hint={`Ngân sách/kỳ: ${vnd(d.budgetPerDraw)}`} />
            <Kpi label="Hạn mức tháng" value={vnd(d.monthlyBudget)} hint={`Đã chi ${vnd(d.monthSpent)} · còn ${vnd(d.monthRemaining)}`} />
            <Kpi label="Hạn mức năm" value={vnd(d.annualBudget)} hint={`Đã chi ${vnd(d.yearSpent)} · còn ${vnd(d.yearRemaining)}`} />
            <Kpi label="Ngân sách còn lại (tháng)" value={vnd(d.monthRemaining)} tone={d.monthRemaining === 0 ? 'warn' : 'default'} />
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Theo tháng" className="lg:col-span-2">
              {d.monthly.length ? <Chart option={opt} height={260} ariaLabel="Chi tiêu và tiền thưởng theo tháng" /> : <EmptyState title="Chưa có giao dịch" />}
            </Card>
            <Card title="Nguyên tắc">
              <ul className="list-disc space-y-2 pl-4 text-xs text-ink-2">
                {d.principles.map((p: string) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">Thay đổi hạn mức tại Cài đặt. Nếu bạn thấy khó kiểm soát việc chơi, hãy tạm dừng và tìm hỗ trợ.</p>
            </Card>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Sổ quỹ" className="lg:col-span-2" subtitle="Bất biến — sai sót được sửa bằng bút toán điều chỉnh.">
              {ledger.error && <ErrorState error={ledger.error} onRetry={ledger.reload} />}
              {ledger.data?.length === 0 && <EmptyState title="Sổ quỹ trống" />}
              {!!ledger.data?.length && (
                <Table head={['Ngày', 'Loại', 'Số tiền', 'Danh mục', 'Kỳ', 'Ghi chú', 'Lúc ghi']}>
                  {ledger.data.map((l) => (
                    <tr key={l.id}>
                      <Td className="whitespace-nowrap text-xs">{dateOnly(l.entry_date)}</Td>
                      <Td>{l.entry_type === 'purchase' ? <Badge>Mua vé</Badge> : l.entry_type === 'prize' ? <Badge tone="good">Thưởng</Badge> : <Badge tone="warn">Điều chỉnh</Badge>}</Td>
                      <Td className={`measured ${l.amount < 0 ? 'text-bad' : 'text-ok'}`}>{vnd(l.amount)}</Td>
                      <Td className="text-xs">{l.portfolio_name ?? '—'}</Td>
                      <Td className="text-xs">{l.draw_code ?? '—'}</Td>
                      <Td className="max-w-[200px] text-xs text-muted">{l.note}</Td>
                      <Td className="whitespace-nowrap text-xs text-muted">{dateTime(l.created_at)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
              <Pagination meta={ledger.meta as any} onPage={setPage} />
            </Card>
            <Card title="Bút toán thủ công" subtitle="Dùng cho giải Jackpot thực nhận (giá trị biến động) hoặc điều chỉnh. Mua vé được ghi qua trang Danh mục.">
              <div className="space-y-3">
                <Field label="Loại">
                  <Select value={f.entry_type} onChange={(e) => setF({ ...f, entry_type: e.target.value })}>
                    <option value="prize">Tiền thưởng</option>
                    <option value="adjustment">Điều chỉnh (+/−)</option>
                  </Select>
                </Field>
                <Field label="Số tiền (VND)">
                  <Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
                </Field>
                <Field label="Ngày">
                  <Input type="date" value={f.entry_date} onChange={(e) => setF({ ...f, entry_date: e.target.value })} />
                </Field>
                <Field label="ID danh mục (tuỳ chọn)">
                  <Input inputMode="numeric" value={f.portfolio_id} onChange={(e) => setF({ ...f, portfolio_id: e.target.value })} />
                </Field>
                <Field label="Ghi chú (bắt buộc)">
                  <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
                </Field>
                <Button variant="primary" loading={busy} disabled={!f.amount || f.note.length < 5} onClick={add}>
                  Ghi bút toán ({mode === 'real' ? 'thực tế' : 'mô phỏng'})
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
