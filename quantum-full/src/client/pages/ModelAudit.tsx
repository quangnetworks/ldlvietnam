import { useState } from 'react';
import { useGame } from '../lib/game';
import { useApi } from '../lib/hooks';
import { dateTime } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingBlock, PageHeader, Pagination, Select, Table, Tabs, Td } from '../components/ui';

const RUN_TYPE: Record<string, string> = { analysis: 'Phân tích', generate: 'Sinh bộ số', portfolio: 'Tối ưu danh mục', backtest: 'Backtest', montecarlo: 'Monte Carlo', ml: 'ML' };

function Models() {
  const { code } = useGame();
  const q = useApi<any[]>(`/models?game=${code}`);
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingBlock />;
  return (
    <Card title="Phiên bản thuật toán" subtitle="Trạng thái kiểm định lấy từ backtest hoàn tất gần nhất của game đang chọn.">
      <Table head={['Mã', 'Tên', 'Phiên bản', 'Loại', 'Số lần chạy', 'Lần cuối', 'Kiểm định']}>
        {q.data.map((m) => (
          <tr key={m.id}>
            <Td className="measured text-xs">{m.code}</Td>
            <Td>
              {m.name} {m.is_baseline ? <Badge tone="info">Baseline</Badge> : null}
              <div className="text-xs text-muted">{m.description}</div>
            </Td>
            <Td>v{m.version}</Td>
            <Td className="text-xs">{m.kind}</Td>
            <Td className="measured">{m.run_count}</Td>
            <Td className="whitespace-nowrap text-xs text-muted">{dateTime(m.last_run_at)}</Td>
            <Td className="max-w-[240px] text-xs">{m.validation ? <span className={/KHÔNG|CHƯA/.test(m.validation.status) ? 'text-warn' : 'text-ink-2'}>{m.validation.status}</span> : '—'}</Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function Runs() {
  const { code } = useGame();
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const q = useApi<any[]>(`/models/runs?game=${code}&page=${page}&page_size=20${type ? `&run_type=${type}` : ''}`);
  return (
    <Card
      title="Lịch sử chạy mô hình (bất biến)"
      actions={
        <Select aria-label="Lọc loại chạy" className="w-44" value={type} onChange={(e) => (setType(e.target.value), setPage(1))}>
          <option value="">Tất cả loại</option>
          {Object.entries(RUN_TYPE).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      }
    >
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {q.loading && !q.data && <LoadingBlock />}
      {q.data?.length === 0 && <EmptyState title="Chưa có lần chạy nào" />}
      {!!q.data?.length && (
        <Table head={['#', 'Thời điểm', 'Loại', 'Mô hình', 'Seed', 'Mốc dữ liệu', 'Số kỳ', 'Người chạy', '']}>
          {q.data.flatMap((r) => [
            <tr key={r.id}>
              <Td>{r.id}</Td>
              <Td className="whitespace-nowrap text-xs text-muted">{dateTime(r.created_at)}</Td>
              <Td>{RUN_TYPE[r.run_type] ?? r.run_type}</Td>
              <Td>
                {r.model_name} <span className="text-xs text-muted">v{r.model_version}</span>
              </Td>
              <Td className="measured text-xs">{r.seed ?? '—'}</Td>
              <Td className="whitespace-nowrap text-xs">{dateTime(r.data_cutoff_at)}</Td>
              <Td className="measured">{r.data_draw_count}</Td>
              <Td className="text-xs text-muted">{r.created_by}</Td>
              <Td>
                <Button variant="ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  {open === r.id ? 'Đóng' : 'Chi tiết'}
                </Button>
              </Td>
            </tr>,
            open === r.id ? (
              <tr key={`${r.id}-d`}>
                <td colSpan={9} className="px-2 pb-3">
                  <div className="grid gap-3 lg:grid-cols-2">
                    <pre className="max-h-64 overflow-auto rounded-[var(--radius-pill)] border border-rule bg-paper p-3 text-[11px]">{JSON.stringify(r.params, null, 2)}</pre>
                    <pre className="max-h-64 overflow-auto rounded-[var(--radius-pill)] border border-rule bg-paper p-3 text-[11px]">{JSON.stringify(r.output, null, 2)}</pre>
                  </div>
                  <p className="mt-1 text-xs text-muted">Mã băm dữ liệu <span className="measured break-all text-ink-2">{r.dataset_hash}</span></p>
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

function AuditLog() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const q = useApi<any[]>(`/audit?page=${page}&page_size=25${action ? `&action=${encodeURIComponent(action)}` : ''}`);
  return (
    <Card title="Nhật ký kiểm toán" subtitle="Ghi lại mọi thao tác quản trị (trước/sau). Không thể sửa hoặc xoá." actions={<Input aria-label="Lọc hành động" placeholder="Lọc theo hành động, vd draws." className="w-56" value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} />}>
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {q.loading && !q.data && <LoadingBlock />}
      {q.data?.length === 0 && <EmptyState title="Chưa có bản ghi" />}
      {!!q.data?.length && (
        <Table head={['#', 'Thời điểm', 'Người thực hiện', 'Hành động', 'Đối tượng', 'Request', '']}>
          {q.data.flatMap((a) => [
            <tr key={a.id}>
              <Td>{a.id}</Td>
              <Td className="whitespace-nowrap text-xs text-muted">{dateTime(a.created_at)}</Td>
              <Td className="text-xs">
                {a.actor} <Badge>{a.actor_role}</Badge>
              </Td>
              <Td className="measured text-xs">{a.action}</Td>
              <Td className="text-xs">
                {a.entity_type} {a.entity_id ? `#${a.entity_id}` : ''}
              </Td>
              <Td className="max-w-[120px] truncate measured text-[10px] text-muted">{a.request_id}</Td>
              <Td>
                <Button variant="ghost" onClick={() => setOpen(open === a.id ? null : a.id)}>
                  {open === a.id ? 'Đóng' : 'Xem'}
                </Button>
              </Td>
            </tr>,
            open === a.id ? (
              <tr key={`${a.id}-d`}>
                <td colSpan={7} className="px-2 pb-3">
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs text-muted">Trước</div>
                      <pre className="max-h-64 overflow-auto rounded-[var(--radius-pill)] border border-rule bg-paper p-3 text-[11px]">{JSON.stringify(a.before, null, 2)}</pre>
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-muted">Sau</div>
                      <pre className="max-h-64 overflow-auto rounded-[var(--radius-pill)] border border-rule bg-paper p-3 text-[11px]">{JSON.stringify(a.after, null, 2)}</pre>
                    </div>
                  </div>
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

export default function ModelAudit() {
  const [tab, setTab] = useState<'models' | 'runs' | 'audit'>('models');
  return (
    <>
      <PageHeader title="Kiểm toán mô hình" description="Phiên bản thuật toán, tham số, seed, mốc dữ liệu và kết quả của mọi lần chạy — phục vụ tái lập và kiểm toán." />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'models', label: 'Phiên bản mô hình' }, { value: 'runs', label: 'Lịch sử chạy' }, { value: 'audit', label: 'Nhật ký kiểm toán' }]} />
      {tab === 'models' && <Models />}
      {tab === 'runs' && <Runs />}
      {tab === 'audit' && <AuditLog />}
    </>
  );
}
