import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiFetch, ApiClientError } from '../lib/api';
import { useApi } from '../lib/hooks';
import { dateOnly, dateTime, num, pct, pv, vnd } from '../lib/format';
import { Badge, RecordLead, Button, Card, EmptyState, ErrorState, Field, Kpi, LoadingBlock, Notice, PageHeader, Pagination, Select, Table, Tabs, Td } from '../components/ui';
import { useToast } from '../components/toast';

type Region = 'mb' | 'mt' | 'mn';
type Tab = 'results' | 'audit' | 'models' | 'value';
const REGION_ITEMS: { value: Region; label: string }[] = [
  { value: 'mb', label: 'Miền Bắc' },
  { value: 'mt', label: 'Miền Trung' },
  { value: 'mn', label: 'Miền Nam' },
];
const VERDICT: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'info' }> = {
  random: { label: 'Ngẫu nhiên', tone: 'good' },
  anomaly: { label: 'Cần rà soát', tone: 'warn' },
  exploitable: { label: 'Cần kiểm chứng', tone: 'bad' },
  insufficient: { label: 'Chưa đủ dữ liệu', tone: 'info' },
  no_edge: { label: 'Không có lợi thế', tone: 'good' },
  edge: { label: 'Cần kiểm chứng', tone: 'bad' },
};
const oneIn = (p: number) => (p > 0 ? `1 / ${num(1 / p)}` : '—');

function Verdict({ d, meta }: { d: any; meta?: any }) {
  const v = VERDICT[d.verdict] ?? VERDICT.insufficient;
  return (
    <RecordLead
      badge={<Badge tone={v.tone}>{v.label}</Badge>}
      headline={d.headline}
      reasons={d.explanation}
      reading={{
        label: d.models ? 'Số kỳ đã chấm walk-forward' : 'Số kỳ đã kiểm định',
        value: num(d.models ? d.models[0]?.draws ?? 0 : d.draws),
        note: meta ? `${meta.cached ? 'Kết quả lưu đệm' : 'Vừa tính'} lúc ${dateTime(meta.computedAt)}. ${meta.dataNotice}` : undefined,
      }}
    />
  );
}

function Results({ region, summary }: { region: Region; summary: any }) {
  const [station, setStation] = useState('');
  const [page, setPage] = useState(1);
  const r = summary.regions.find((x: any) => x.region === region);
  const q = useApi<any[]>(`/xskt/draws?region=${region}&page=${page}&page_size=10${station ? `&station=${encodeURIComponent(station)}` : ''}`);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Số kỳ đã lưu" value={num(r?.draws)} hint={`${r?.numbersPerDraw} số mỗi kỳ`} />
        <Kpi label="Số đài" value={num(r?.stations.length)} hint={`Đang quay: ${num(r?.stations.filter((s: any) => s.active).length)}`} />
        <Kpi label="Kỳ mới nhất" value={r?.latestDate ? dateOnly(r.latestDate) : '—'} />
        <Kpi label="Lần đồng bộ gần nhất" value={summary.sync?.lastRunAt ? dateTime(summary.sync.lastRunAt) : '—'} />
      </div>
      {r?.stations.length > 1 && (
        <Card title="Lịch quay theo thứ" subtitle="Suy ra từ dữ liệu 120 ngày gần nhất (tự cập nhật khi đài đổi lịch / sáp nhập).">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {r.schedule.map((d: any) => (
              <div key={d.weekday} className="rounded-[var(--radius-pill)] border border-rule p-2 text-xs">
                <div className="font-medium text-ink">{d.name}</div>
                <div className="text-muted">{d.stations.join(', ') || '—'}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card
        title="Kết quả quay"
        actions={
          r?.stations.length > 1 && (
            <Select aria-label="Chọn đài" value={station} onChange={(e) => (setStation(e.target.value), setPage(1))} className="w-48">
              <option value="">Tất cả đài</option>
              {r.stations.map((s: any) => (
                <option key={s.station} value={s.station}>
                  {s.station}
                </option>
              ))}
            </Select>
          )
        }
      >
        {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
        {!q.data && !q.error && <LoadingBlock rows={4} />}
        {q.data?.length === 0 && <EmptyState title="Chưa có dữ liệu" description="Bấm “Đồng bộ XSKT” để tải kết quả từ nguồn mở." />}
        <div className="grid gap-3 lg:grid-cols-2">
          {q.data?.map((d: any) => (
            <div key={d.id} className="rounded-[var(--radius-pill)] border border-rule p-3">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium">{d.station}</span>
                <span className="text-xs text-muted">{dateOnly(d.date)}</span>
              </div>
              <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-xs">
                {d.prizes.map((p: any) => (
                  <div key={p.code} className="contents">
                    <dt className="text-muted">{p.name}</dt>
                    <dd className={`measured flex flex-wrap gap-x-3 gap-y-0.5 ${p.code === 'special' ? 'font-medium text-accent' : 'text-ink-2'}`}>{p.numbers.map((n: string, i: number) => <span key={i}>{n}</span>)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <Pagination meta={q.meta as any} onPage={setPage} />
      </Card>
    </div>
  );
}

function Audit({ region }: { region: Region }) {
  const q = useApi<any>(`/xskt/audit?region=${region}`);
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingBlock rows={6} />;
  const d = q.data;
  return (
    <div className="space-y-5">
      <Verdict d={d} meta={q.meta} />
      {d.tests.length > 0 && (
        <>
          <Card title={`Kiểm định toàn ${d.region === 'mb' ? 'miền Bắc' : d.region === 'mt' ? 'miền Trung' : 'miền Nam'}`} subtitle={`${num(d.draws)} kỳ · ${num(d.stations)} đài · q: sau hiệu chỉnh Benjamini–Hochberg trên toàn bộ kiểm định (miền + từng đài).`}>
            <Table head={['Kiểm định', 'Thống kê', 'p', 'q', 'Kết luận']}>
              {d.tests.map((t: any) => (
                <tr key={t.code}>
                  <Td>
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted">{t.detail}</div>
                  </Td>
                  <Td className="measured whitespace-nowrap">
                    {num(t.statistic, 2)}
                    {t.df != null && <span className="text-xs text-muted"> (df {t.df})</span>}
                  </Td>
                  <Td className="measured">{pv(t.pValue)}</Td>
                  <Td className="measured">{t.structural ? '—' : pv(t.qValue)}</Td>
                  <Td>{t.structural ? <Badge tone="info">Quy tắc quay</Badge> : t.significant ? <Badge tone="warn">Lệch</Badge> : <Badge tone="good">Khớp ngẫu nhiên</Badge>}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          {d.stationAudits.length > 0 && (
            <Card title="Theo từng đài" subtitle="Hai chữ số cuối, chữ số hàng đơn vị và phụ thuộc kỳ trước của từng đài (đài có ít nhất 200 kỳ).">
              <Table head={['Đài', 'Số kỳ', 'Giai đoạn', 'q nhỏ nhất', 'Kết luận']}>
                {d.stationAudits.map((s: any) => {
                  const minQ = Math.min(...s.tests.map((t: any) => t.qValue));
                  const bad = s.tests.filter((t: any) => t.significant);
                  return (
                    <tr key={s.station}>
                      <Td>{s.station}</Td>
                      <Td className="measured">{num(s.draws)}</Td>
                      <Td className="whitespace-nowrap text-xs">
                        từ {dateOnly(s.firstDate)} đến {dateOnly(s.lastDate)}
                      </Td>
                      <Td className="measured">{pv(minQ)}</Td>
                      <Td>{s.flagged ? <Badge tone="warn">{`Lệch: ${bad.map((t: any) => t.name).join(', ')}`}</Badge> : <Badge tone="good">Khớp ngẫu nhiên</Badge>}</Td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Models({ region, summary }: { region: Region; summary: any }) {
  const [station, setStation] = useState('');
  const [win, setWin] = useState('30');
  const r = summary.regions.find((x: any) => x.region === region);
  const q = useApi<any>(`/xskt/models?region=${region}&window=${win}${station ? `&station=${encodeURIComponent(station)}` : ''}`);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3 lg:w-2/3">
        {r?.stations.length > 1 && (
          <Field label="Đài">
            <Select value={station} onChange={(e) => setStation(e.target.value)}>
              <option value="">Tất cả đài (chấm riêng từng đài rồi gộp)</option>
              {r.stations.map((s: any) => (
                <option key={s.station} value={s.station}>
                  {s.station}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Cửa sổ số nóng / lạnh">
          <Select value={win} onChange={(e) => setWin(e.target.value)}>
            <option value="10">10 kỳ</option>
            <option value="30">30 kỳ</option>
            <option value="100">100 kỳ</option>
          </Select>
        </Field>
      </div>
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {!q.data && !q.error && <LoadingBlock rows={6} />}
      {q.data && (
        <>
          <Verdict d={q.data} meta={q.meta} />
          <Card title="Bảng xếp hạng mô hình" subtitle="Walk-forward: mỗi kỳ chỉ dùng dữ liệu trước đó của chính đài. Log-loss thấp hơn ln 10 ≈ 2,30259 mới là dự báo tốt hơn chọn ngẫu nhiên.">
            <Table head={['Mô hình', 'Số kỳ chấm', 'Log-loss', 'Cải thiện', 'z', 'q', 'Đoán đúng chữ số cuối', 'Vé gợi ý trúng giải', 'Tiền thưởng TB / vé']}>
              {q.data.models.map((m: any) => (
                <tr key={m.code}>
                  <Td>
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-muted">{m.description}</div>
                  </Td>
                  <Td className="measured">{num(m.draws)}</Td>
                  <Td className="measured">{num(m.logLoss, 5)}</Td>
                  <Td className={`measured ${m.improvement > 0 ? 'text-ok' : m.code === 'uniform' ? '' : 'text-warn'}`}>{m.code === 'uniform' ? '—' : `${m.improvement >= 0 ? '+' : ''}${num(m.improvement * 1000, 3)}‰`}</Td>
                  <Td className="measured">{m.code === 'uniform' ? '—' : num(m.z, 2)}</Td>
                  <Td className="measured">{m.code === 'uniform' ? '—' : pv(m.qValue)}</Td>
                  <Td className="measured">{pct(m.unitsHitRate, 2)}</Td>
                  <Td className="measured">{pct(m.ticketWinRate, 2)}</Td>
                  <Td className="measured">{vnd(m.ticketMeanPayout)}</Td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 text-xs text-muted">
              Chuẩn ngẫu nhiên: đoán đúng chữ số cuối 10%; vé bất kỳ trúng ít nhất một giải {pct(q.data.expectedWinRate, 2)} số kỳ; kỳ vọng tiền thưởng {vnd(q.data.expectedPayout)}/vé. Tiền thưởng trung bình của từng mô hình dao động rất mạnh vì giải lớn hiếm — chỉ có ý nghĩa khi so cùng chuẩn kỳ vọng.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

function Value() {
  const q = useApi<any>('/xskt/value');
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingBlock rows={6} />;
  const d = q.data;
  const rows = [
    ...d.xskt.map((x: any) => ({ key: x.region, name: `XSKT ${x.name}`, pre: x.returnRatio, post: x.returnRatioAfterTax, note: `P(trúng ≥ 1 giải) ${pct(x.pAnyPrize, 2)}` })),
    ...d.vietlott.map((v: any) => ({ key: v.code, name: v.name, pre: v.returnRatio, post: v.returnRatioAfterTax, note: v.note })),
  ].sort((a, b) => (Number.isNaN(b.post) ? -1 : b.post) - (Number.isNaN(a.post) ? -1 : a.post));
  return (
    <div className="space-y-5">
      <Card title="Mỗi 10.000đ nhận lại trung bình bao nhiêu?" subtitle="So sánh vé XSKT với Vietlott theo giá trị kỳ vọng (Jackpot theo số liệu đã nhập ở trang Quyết định hôm nay).">
        <Table head={['Loại vé', 'Hoàn lại (trước thuế)', 'Hoàn lại (sau thuế)', 'Ghi chú']}>
          {rows.map((r) => (
            <tr key={r.key}>
              <Td className="font-medium">{r.name}</Td>
              <Td className="measured">{Number.isNaN(r.pre) ? '—' : pct(r.pre, 1)}</Td>
              <Td className={`measured ${r.post >= 1 ? 'text-ok' : ''}`}>{Number.isNaN(r.post) ? '—' : pct(r.post, 1)}</Td>
              <Td className="text-xs text-muted">{r.note}</Td>
            </tr>
          ))}
        </Table>
        <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-ink-2">
          {d.insights.map((i: string) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </Card>
      <div className="grid gap-5 xl:grid-cols-3">
        {d.xskt.map((x: any) => (
          <Card key={x.region} title={`Cơ cấu giải — ${x.name}`} subtitle={x.note}>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <Kpi label="Kỳ vọng / vé" value={vnd(x.expectedPrize)} hint={`Sau thuế ${vnd(x.expectedPrizeAfterTax)}`} />
              <Kpi label="P(trúng ≥ 1 giải)" value={pct(x.pAnyPrize, 3)} hint={oneIn(x.pAnyPrize)} />
            </div>
            <Table head={['Giải', 'Giá trị', 'Xác suất / vé', 'Số giải / loại vé']}>
              {x.tiers.map((t: any) => (
                <tr key={t.code}>
                  <Td>{t.name}</Td>
                  <Td className="measured whitespace-nowrap">{vnd(t.amount)}</Td>
                  <Td className="measured whitespace-nowrap">{oneIn(t.probability)}</Td>
                  <Td className="measured">{num(t.perSeries, t.perSeries % 1 ? 1 : 0)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function Xskt() {
  const toast = useToast();
  const [region, setRegion] = useState<Region>('mn');
  const [tab, setTab] = useState<Tab>('results');
  const [busy, setBusy] = useState(false);
  const summary = useApi<any>('/xskt/summary');
  const sync = async () => {
    setBusy(true);
    try {
      const r = await apiFetch('/admin/xskt/sync', { body: {} });
      const ins = r.data.reduce((s: number, x: any) => s + x.inserted, 0);
      const err = r.data.find((x: any) => x.error);
      toast(err ? 'error' : 'success', err ? `Lỗi đồng bộ ${err.region}: ${err.error}` : `Đã nhập ${ins.toLocaleString('vi-VN')} kỳ${r.data.some((x: any) => x.backlog) ? ' — còn dữ liệu lịch sử, bấm tiếp để nhập dần' : ''}`);
      summary.reload();
    } catch (e) {
      toast('error', e instanceof ApiClientError ? e.message : 'Không đồng bộ được');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Xổ số kiến thiết"
        description="Kết quả 3 miền, kiểm định tính ngẫu nhiên theo từng đài, mô hình dự báo chấm công khai so với chọn ngẫu nhiên, và giá trị thực của mỗi vé. Không có chức năng lô/đề."
        actions={
          <Button loading={busy} onClick={sync}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Đồng bộ XSKT
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Chọn miền" className="flex gap-1 rounded-[var(--radius-pill)] border border-rule bg-paper-2 p-1">
          {REGION_ITEMS.map((r) => (
            <button key={r.value} role="radio" aria-checked={region === r.value} onClick={() => setRegion(r.value)} className={`rounded-[var(--radius-pill)] px-3 py-1.5 text-sm ${region === r.value ? 'bg-accent/20 text-ink' : 'text-muted hover:text-ink'}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'results', label: 'Kết quả' },
          { value: 'audit', label: 'Kiểm định' },
          { value: 'models', label: 'Mô hình dự báo' },
          { value: 'value', label: 'Giá trị vé' },
        ]}
      />
      {summary.error && <ErrorState error={summary.error} onRetry={summary.reload} />}
      {!summary.data && !summary.error && <LoadingBlock rows={6} />}
      {summary.data && (
        <>
          {summary.data.regions.every((r: any) => r.draws === 0) && (
            <div className="mb-4">
              <Notice tone="info">Chưa có dữ liệu XSKT. Bấm “Đồng bộ XSKT” (quản trị viên) — lần đầu nhập dần khoảng 3.000 kỳ mỗi lần; hệ thống cũng tự đồng bộ mỗi giờ.</Notice>
            </div>
          )}
          {tab === 'results' && <Results key={region} region={region} summary={summary.data} />}
          {tab === 'audit' && <Audit key={region} region={region} />}
          {tab === 'models' && <Models key={region} region={region} summary={summary.data} />}
          {tab === 'value' && <Value />}
          <p className="mt-6 text-xs text-muted">{summary.data.dataNotice}</p>
        </>
      )}
    </>
  );
}
