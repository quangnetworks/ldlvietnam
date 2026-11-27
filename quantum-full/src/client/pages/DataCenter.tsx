import { useState } from 'react';
import { CheckCheck, FileUp, RefreshCw, ShieldCheck, ShieldX, Wrench } from 'lucide-react';
import { apiFetch, ApiClientError } from '../lib/api';
import { useGame } from '../lib/game';
import { useApi } from '../lib/hooks';
import { dateOnly, dateTime, num, todayVn } from '../lib/format';
import { Badge, Balls, Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, Notice, PageHeader, Pagination, Select, Table, Tabs, Td, Textarea } from '../components/ui';
import { useToast } from '../components/toast';

type Tab = 'sync' | 'draws' | 'import' | 'manual' | 'jobs' | 'sources';

function statusBadge(s: string) {
  return s === 'verified' ? <Badge tone="good">Đã xác minh</Badge> : s === 'rejected' ? <Badge tone="bad">Từ chối</Badge> : <Badge tone="warn">Chưa xác minh</Badge>;
}

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : 'Có lỗi xảy ra');

/** Kỳ thiếu giờ quay (đồng bộ trước khi đủ kỳ trong ngày): quản trị viên điền giờ để danh mục chấm được. */
function MissingTime({ drawId, times, onDone }: { drawId: number; times: string[]; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const fill = async (t: string) => {
    if (!t) return;
    setBusy(true);
    try {
      await apiFetch(`/admin/draws/${drawId}/time`, { body: { draw_time: t } });
      toast('success', `Đã điền giờ quay ${t}`);
      onDone();
    } catch (e) {
      toast('error', e instanceof ApiClientError ? e.message : 'Không điền được giờ quay');
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="ml-2 inline-flex items-center gap-1.5 align-middle">
      <Badge tone="warn">Thiếu giờ</Badge>
      <Select aria-label="Điền giờ quay" disabled={busy} defaultValue="" onChange={(e) => fill(e.target.value)} className="h-7 w-24 px-2 text-xs">
        <option value="" disabled>
          Điền giờ
        </option>
        {times.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </Select>
    </span>
  );
}

function DrawsTab() {
  const { code, game } = useGame();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [correcting, setCorrecting] = useState<any | null>(null);
  const [corr, setCorr] = useState({ main: '', special: '', reason: '' });
  const q = useApi<any[]>(code ? `/draws?game=${code}&page=${page}&page_size=25${status ? `&status=${status}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}` : null);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', ok);
      setSelected(new Set());
      q.reload();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: number) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const unverifiedOnPage = (q.data ?? []).filter((d) => d.verificationStatus === 'unverified').map((d) => d.id as number);

  return (
    <Card
      title="Kết quả quay"
      subtitle={q.meta?.statusCounts ? `Đã xác minh ${num(q.meta.statusCounts.verified ?? 0)} · Chưa xác minh ${num(q.meta.statusCounts.unverified ?? 0)} · Từ chối ${num(q.meta.statusCounts.rejected ?? 0)}` : undefined}
      actions={
        <>
          <Button variant="secondary" disabled={!unverifiedOnPage.length} onClick={() => setSelected(new Set(unverifiedOnPage))}>
            Chọn chưa xác minh
          </Button>
          <Button variant="primary" disabled={!selected.size} loading={busy} onClick={() => act(() => apiFetch('/admin/draws/verify-batch', { body: { ids: [...selected], note: 'Đối chiếu nguồn chính thức' } }), `Đã xác minh ${selected.size} kỳ`)}>
            <CheckCheck className="h-4 w-4" aria-hidden /> Xác minh ({selected.size})
          </Button>
        </>
      }
    >
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <Select aria-label="Lọc trạng thái" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="">Tất cả trạng thái</option>
          <option value="verified">Đã xác minh</option>
          <option value="unverified">Chưa xác minh</option>
          <option value="rejected">Từ chối</option>
        </Select>
        <Input aria-label="Tìm mã kỳ" placeholder="Tìm mã kỳ…" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
      </div>
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {q.loading && !q.data && <LoadingBlock />}
      {q.data && q.data.length === 0 && <EmptyState title="Chưa có kết quả quay" description="Dùng tab “Nhập dữ liệu” để import CSV/JSON từ nguồn chính thức." />}
      {q.data && q.data.length > 0 && (
        <Table head={['', 'Kỳ', 'Ngày quay', 'Kết quả', 'Nguồn', 'Trạng thái', '']}>
          {q.data.map((d) => (
            <tr key={d.id}>
              <Td>
                <input type="checkbox" aria-label={`Chọn kỳ ${d.drawCode}`} disabled={d.verificationStatus !== 'unverified'} checked={selected.has(d.id)} onChange={() => toggle(d.id)} className="h-4 w-4 accent-accent" />
              </Td>
              <Td className="measured">#{d.drawCode}</Td>
              <Td className="whitespace-nowrap text-muted">
                {dateOnly(d.drawDate)} {d.drawTime ?? ''}
                {!d.drawTime && (game?.drawSchedule?.times?.length ?? 0) > 1 && <MissingTime drawId={d.id} times={game!.drawSchedule!.times} onDone={q.reload} />}
              </Td>
              <Td>
                <Balls main={d.main} special={d.special} size="sm" />
              </Td>
              <Td className="text-xs text-muted">
                {d.sourceName}
                <div className="measured text-[10px] text-rule-2" title={d.sourceHash}>
                  {d.sourceHash.slice(0, 12)}…
                </div>
              </Td>
              <Td>{statusBadge(d.verificationStatus)}</Td>
              <Td>
                <div className="flex justify-end gap-1">
                  {d.verificationStatus !== 'verified' && (
                    <Button variant="ghost" aria-label="Xác minh" title="Xác minh" onClick={() => act(() => apiFetch(`/admin/draws/${d.id}/verify`, { body: { status: 'verified' } }), `Đã xác minh kỳ ${d.drawCode}`)}>
                      <ShieldCheck className="h-4 w-4" />
                    </Button>
                  )}
                  {d.verificationStatus === 'unverified' && (
                    <Button variant="ghost" aria-label="Từ chối" title="Từ chối" onClick={() => act(() => apiFetch(`/admin/draws/${d.id}/verify`, { body: { status: 'rejected', note: 'Không khớp nguồn chính thức' } }), `Đã từ chối kỳ ${d.drawCode}`)}>
                      <ShieldX className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="ghost" aria-label="Điều chỉnh" title="Điều chỉnh có audit" onClick={() => (setCorrecting(d), setCorr({ main: d.main.join(' '), special: d.special?.toString() ?? '', reason: '' }))}>
                    <Wrench className="h-4 w-4" />
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Pagination meta={q.meta as any} onPage={setPage} />
      {correcting && (
        <div className="mt-4 rounded-[var(--radius-pill)] border border-warn/30 bg-warn/5 p-4">
          <div className="mb-3 text-sm font-medium">Điều chỉnh kỳ #{correcting.drawCode}</div>
          <Notice tone="warn">Điều chỉnh sẽ đưa kỳ về trạng thái “chưa xác minh”, xoá kết quả chấm vé phát sinh, và ghi audit log trước/sau. Dự báo đã lưu không bị thay đổi.</Notice>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label={`Số chính (${game?.mainPicks} số)`}>
              <Input value={corr.main} onChange={(e) => setCorr({ ...corr, main: e.target.value })} />
            </Field>
            {game?.specialMode !== 'none' && (
              <Field label="Số đặc biệt">
                <Input inputMode="numeric" value={corr.special} onChange={(e) => setCorr({ ...corr, special: e.target.value })} />
              </Field>
            )}
            <Field label="Lý do (bắt buộc, ≥ 10 ký tự)">
              <Input value={corr.reason} onChange={(e) => setCorr({ ...corr, reason: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              variant="primary"
              loading={busy}
              onClick={() =>
                act(
                  () =>
                    apiFetch(`/admin/draws/${correcting.id}/correct`, {
                      body: { main: corr.main.split(/[\s,;-]+/).filter(Boolean).map(Number), special: corr.special === '' ? null : Number(corr.special), reason: corr.reason },
                    }).then(() => setCorrecting(null)),
                  'Đã điều chỉnh, vui lòng xác minh lại',
                )
              }
            >
              Lưu điều chỉnh
            </Button>
            <Button variant="ghost" onClick={() => setCorrecting(null)}>
              Huỷ
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ImportTab() {
  const { code, game } = useGame();
  const toast = useToast();
  const sources = useApi<any[]>('/data-sources');
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [content, setContent] = useState('');
  const [sourceId, setSourceId] = useState('1');
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const sample =
    game?.specialMode === 'none'
      ? 'draw_code,draw_date,draw_time,numbers'
      : 'draw_code,draw_date,draw_time,numbers,special';
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) return toast('error', 'Tệp vượt 2MB');
    setContent(await f.text());
    setFormat(f.name.toLowerCase().endsWith('.json') ? 'json' : 'csv');
  };
  const submit = async () => {
    setBusy(true);
    try {
      const r = await apiFetch('/admin/draws/import', { body: { game: code, format, content, data_source_id: Number(sourceId), source_url: sourceUrl || null } });
      setResult(r.data);
      toast(r.data.inserted > 0 ? 'success' : 'error', `Đã nhập ${r.data.inserted}/${r.data.totalRows} dòng`);
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Nhập kết quả quay (CSV / JSON)" className="lg:col-span-2">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Định dạng">
            <Select value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'json')}>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </Select>
          </Field>
          <Field label="Nguồn dữ liệu">
            <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {(sources.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.kind === 'official' ? 'chính thức' : s.kind === 'manual' ? 'nhập tay' : 'tham khảo'})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="URL nguồn (tuỳ chọn)">
            <Input placeholder="https://vietlott.vn/…" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Nội dung" hint={format === 'csv' ? `Dòng tiêu đề: ${sample}. Ngày dạng YYYY-MM-DD, giờ HH:MM (tuỳ chọn), số cách nhau bằng khoảng trắng.` : 'Mảng [{ "draw_code", "draw_date", "draw_time", "main": [...], "special" }]'}>
            <Textarea rows={10} value={content} onChange={(e) => setContent(e.target.value)} placeholder={format === 'csv' ? `${sample}\n...` : '[ ... ]'} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[var(--radius-pill)] border border-rule bg-paper-3 px-3.5 text-sm hover:border-rule-2">
            <FileUp className="h-4 w-4" aria-hidden /> Chọn tệp
            <input type="file" accept=".csv,.json,text/csv,application/json" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <Button variant="primary" loading={busy} disabled={!content.trim()} onClick={submit}>
            Nhập dữ liệu
          </Button>
        </div>
        {result && (
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge tone={result.status === 'completed' ? 'good' : result.status === 'partial' ? 'warn' : 'bad'}>{result.status}</Badge>
              <Badge tone="good">Thêm mới {result.inserted}</Badge>
              <Badge>Trùng {result.duplicates}</Badge>
              <Badge tone="warn">Xung đột {result.conflicts}</Badge>
              <Badge tone="bad">Không hợp lệ {result.invalid}</Badge>
            </div>
            {result.errors.length > 0 && (
              <ul className="max-h-48 overflow-auto rounded-[var(--radius-pill)] border border-rule bg-paper p-2 text-xs">
                {result.errors.slice(0, 100).map((e: any, i: number) => (
                  <li key={i} className="py-0.5">
                    Dòng {e.row} {e.drawCode ? `(kỳ ${e.drawCode})` : ''}: <span className="text-bad">{e.message}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">Dữ liệu mới nhập ở trạng thái “chưa xác minh”. Hãy đối chiếu nguồn chính thức rồi xác minh tại tab Kết quả quay.</p>
          </div>
        )}
      </Card>
      <Card title="Nguyên tắc dữ liệu">
        <ul className="list-disc space-y-2 pl-4 text-xs text-muted">
          <li>Ưu tiên nguồn chính thức Vietlott; nguồn bên thứ ba chỉ là tham khảo.</li>
          <li>Hệ thống không tự thu thập (scrape) website, không vượt giới hạn truy cập.</li>
          <li>Mỗi kỳ lưu nguồn, mã băm SHA-256, thời điểm nhập và trạng thái xác minh.</li>
          <li>Kỳ đã tồn tại với nội dung khác bị đánh dấu xung đột, không ghi đè.</li>
          <li>Không nhận kết quả có ngày quay trong tương lai.</li>
        </ul>
      </Card>
    </div>
  );
}

function ManualTab() {
  const { code, game } = useGame();
  const toast = useToast();
  const [f, setF] = useState({ draw_code: '', draw_date: todayVn(), draw_time: '', main: '', special: '' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await apiFetch('/admin/draws', {
        body: { game: code, draw_code: f.draw_code.trim(), draw_date: f.draw_date, draw_time: f.draw_time || null, main: f.main.split(/[\s,;-]+/).filter(Boolean).map(Number), special: f.special === '' ? null : Number(f.special) },
      });
      toast('success', `Đã nhập kỳ ${f.draw_code} (chưa xác minh)`);
      setF({ ...f, draw_code: '', main: '', special: '' });
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Nhập tay có kiểm soát" subtitle="Mỗi lần nhập được kiểm tra miền số, trùng số và ghi audit log.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Mã kỳ">
          <Input value={f.draw_code} onChange={(e) => setF({ ...f, draw_code: e.target.value })} placeholder="vd 01234" />
        </Field>
        <Field label="Ngày quay">
          <Input type="date" max={todayVn()} value={f.draw_date} onChange={(e) => setF({ ...f, draw_date: e.target.value })} />
        </Field>
        <Field label="Giờ quay (tuỳ chọn)">
          <Input type="time" value={f.draw_time} onChange={(e) => setF({ ...f, draw_time: e.target.value })} />
        </Field>
        <Field label={`Số chính (${game?.mainPicks} số, ${game?.mainMin}–${game?.mainMax})`}>
          <Input value={f.main} onChange={(e) => setF({ ...f, main: e.target.value })} placeholder="05 12 19 27 33" />
        </Field>
        {game?.specialMode !== 'none' && (
          <Field label={game?.specialMode === 'separate_pool' ? `Số đặc biệt (${game.specialMin}–${game.specialMax})` : 'Số đặc biệt (từ số còn lại)'}>
            <Input inputMode="numeric" value={f.special} onChange={(e) => setF({ ...f, special: e.target.value })} />
          </Field>
        )}
      </div>
      <Button className="mt-4" variant="primary" loading={busy} disabled={!f.draw_code || !f.main} onClick={submit}>
        Lưu kết quả
      </Button>
    </Card>
  );
}

function JobsTab() {
  const { code } = useGame();
  const [page, setPage] = useState(1);
  const q = useApi<any[]>(`/import-jobs?game=${code}&page=${page}&page_size=20`);
  return (
    <Card title="Lịch sử nhập dữ liệu">
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
      {q.loading && !q.data && <LoadingBlock />}
      {q.data?.length === 0 && <EmptyState title="Chưa có lần nhập nào" />}
      {!!q.data?.length && (
        <Table head={['#', 'Thời điểm', 'Định dạng', 'Nguồn', 'Kết quả', 'Hash payload', 'Người nhập']}>
          {q.data.map((j) => (
            <tr key={j.id}>
              <Td>{j.id}</Td>
              <Td className="whitespace-nowrap text-xs text-muted">{dateTime(j.created_at)}</Td>
              <Td>{j.format.toUpperCase()}</Td>
              <Td className="text-xs">
                {j.source_name}
                {j.source_url && <div className="max-w-[200px] truncate text-muted">{j.source_url}</div>}
              </Td>
              <Td className="text-xs">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><Badge tone={j.status === 'completed' ? 'good' : j.status === 'partial' ? 'warn' : 'bad'}>{j.status}</Badge><span>thêm <span className="measured text-ok">{j.inserted}</span></span><span>trùng <span className="measured">{j.duplicates}</span></span><span>xung đột <span className="measured">{j.conflicts}</span></span><span>lỗi <span className="measured">{j.invalid}</span></span></div>
              </Td>
              <Td className="measured text-[10px] text-muted" title={j.payload_hash}>
                {j.payload_hash.slice(0, 16)}…
              </Td>
              <Td className="text-xs text-muted">{j.created_by}</Td>
            </tr>
          ))}
        </Table>
      )}
      <Pagination meta={q.meta as any} onPage={setPage} />
    </Card>
  );
}

function SourcesTab() {
  const toast = useToast();
  const q = useApi<any[]>('/data-sources');
  const [f, setF] = useState({ name: '', kind: 'third_party', url: '' });
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await apiFetch('/admin/data-sources', { body: { name: f.name, kind: f.kind, url: f.url || null } });
      toast('success', 'Đã thêm nguồn dữ liệu');
      setF({ name: '', kind: 'third_party', url: '' });
      q.reload();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Nguồn dữ liệu" className="lg:col-span-2">
        {q.loading && !q.data && <LoadingBlock />}
        {q.error && <ErrorState error={q.error} onRetry={q.reload} />}
        {q.data && (
          <Table head={['Tên', 'Loại', 'URL', 'Ghi chú']}>
            {q.data.map((s) => (
              <tr key={s.id}>
                <Td>{s.name}</Td>
                <Td>{s.kind === 'official' ? <Badge tone="good">Chính thức</Badge> : s.kind === 'manual' ? <Badge>Nhập tay</Badge> : <Badge tone="warn">Tham khảo</Badge>}</Td>
                <Td className="max-w-[200px] truncate text-xs text-muted">{s.url ?? '—'}</Td>
                <Td className="text-xs text-muted">{s.notes ?? ''}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Thêm nguồn">
        <div className="space-y-3">
          <Field label="Tên nguồn">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Loại">
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="official">Chính thức</option>
              <option value="third_party">Bên thứ ba (tham khảo)</option>
              <option value="manual">Nhập tay</option>
            </Select>
          </Field>
          <Field label="URL">
            <Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" />
          </Field>
          <Button variant="primary" loading={busy} disabled={f.name.length < 2} onClick={add}>
            Thêm nguồn
          </Button>
        </div>
      </Card>
    </div>
  );
}

function SyncTab() {
  const toast = useToast();
  const q = useApi<any>('/sync/status');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [verifying, setVerifying] = useState<number | null>(null);
  const syncNow = async () => {
    setBusy(true);
    try {
      const r = await apiFetch('/admin/sync', { body: {} });
      const msg = r.data.results.map((x: any) => (x.error ? `${x.game}: lỗi — ${x.error}` : `${x.game}: +${x.import?.inserted ?? 0} kỳ mới`)).join(' · ');
      toast(r.data.results.some((x: any) => x.error) ? 'error' : 'success', msg || 'Không có dữ liệu mới');
      q.reload();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (enabled: boolean) => {
    try {
      await apiFetch('/admin/settings', { method: 'PUT', body: { auto_sync_enabled: enabled } });
      toast('success', enabled ? 'Đã bật đồng bộ tự động' : 'Đã tắt đồng bộ tự động');
      q.reload();
    } catch (e) {
      toast('error', errMsg(e));
    }
  };
  const verifyJob = async (id: number) => {
    setVerifying(id);
    try {
      const r = await apiFetch(`/admin/import-jobs/${id}/verify`, { body: { note } });
      toast('success', `Đã xác minh ${r.data.verified} kỳ của lần nhập #${id}`);
      q.reload();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setVerifying(null);
    }
  };
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingBlock />;
  const d = q.data;
  return (
    <div className="space-y-5">
      <Notice tone="warn">{d.officialSourceNote}</Notice>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card
          title="Nguồn dữ liệu mở"
          className="lg:col-span-2"
          actions={
            <Button variant="primary" loading={busy} onClick={syncNow}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Đồng bộ ngay
            </Button>
          }
        >
          <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Nguồn</dt>
            <dd>
              {d.source?.name} <Badge tone="warn">Bên thứ ba</Badge>
            </dd>
            <dt className="text-muted">Kho dữ liệu</dt>
            <dd className="break-all text-xs">{d.source?.url}</dd>
            <dt className="text-muted">Tệp đồng bộ</dt>
            <dd className="space-y-0.5 text-xs">
              {d.sources.map((s: any) => (
                <div key={s.game}>
                  {s.game}: <span className="break-all text-muted">{s.url}</span>
                </div>
              ))}
            </dd>
            <dt className="text-muted">Lịch tự động</dt>
            <dd>{d.schedule}</dd>
            <dt className="text-muted">Lần chạy gần nhất</dt>
            <dd>
              {d.lastRun ? (
                <>
                  {dateTime(d.lastRun.at)} <span className="text-xs text-muted">({d.lastRun.actor})</span>
                  <ul className="mt-1 text-xs text-muted">
                    {d.lastRun.results.map((r: any) => (
                      <li key={r.game}>
                        {r.game}: {r.error ? <span className="text-bad">{r.error}</span> : `+${r.inserted} kỳ, lỗi ${r.invalid}, xung đột ${r.conflicts}`}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                'Chưa chạy'
              )}
            </dd>
          </dl>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={!!d.enabled} onChange={(e) => toggle(e.target.checked)} />
            Bật đồng bộ tự động theo lịch
          </label>
        </Card>
        <Card title="Quy trình">
          <ol className="list-decimal space-y-2 pl-4 text-xs text-ink-2">
            <li>Hệ thống tải dữ liệu mới từ nguồn mở (1 request/tệp/lần, định danh trung thực).</li>
            <li>Mỗi kỳ được kiểm tra miền số, trùng số, số đặc biệt, ngày; kỳ lỗi bị từ chối và ghi lại.</li>
            <li>Kỳ hợp lệ được lưu ở trạng thái CHƯA XÁC MINH, kèm mã băm nguồn.</li>
            <li>Bạn đối chiếu với kết quả chính thức trên vietlott.vn, rồi xác minh cả lần nhập.</li>
            <li>Chỉ dữ liệu đã xác minh được dùng cho thống kê và backtest (mặc định).</li>
          </ol>
        </Card>
      </div>
      <Card title="Các lần đồng bộ">
        <div className="mb-3 max-w-xl">
          <Field label="Ghi chú xác minh (bắt buộc ≥ 10 ký tự khi xác minh cả lần nhập)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="vd: Đã đối chiếu kết quả trên vietlott.vn ngày …" />
          </Field>
        </div>
        {d.jobs.length === 0 ? (
          <EmptyState title="Chưa có lần đồng bộ nào" description="Bấm “Đồng bộ ngay” để tải dữ liệu lần đầu." />
        ) : (
          <Table head={['#', 'Thời điểm', 'Game', 'Kết quả', 'Chưa xác minh', '']}>
            {d.jobs.map((j: any) => (
              <tr key={j.id}>
                <Td>{j.id}</Td>
                <Td className="whitespace-nowrap text-xs text-muted">{dateTime(j.created_at)}</Td>
                <Td>{j.game_code}</Td>
                <Td className="text-xs">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><Badge tone={j.status === 'completed' ? 'good' : j.status === 'partial' ? 'warn' : 'bad'}>{j.status}</Badge><span>thêm <span className="measured text-ok">{j.inserted}</span></span><span>lỗi <span className="measured">{j.invalid}</span></span><span>xung đột <span className="measured">{j.conflicts}</span></span></div>
                </Td>
                <Td className="measured">{num(j.unverified)}</Td>
                <Td>
                  {j.unverified > 0 && (
                    <Button variant="secondary" disabled={note.trim().length < 10} loading={verifying === j.id} onClick={() => verifyJob(j.id)}>
                      <CheckCheck className="h-4 w-4" aria-hidden /> Xác minh cả lần nhập
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

export default function DataCenter() {
  const [tab, setTab] = useState<Tab>('sync');
  return (
    <>
      <PageHeader title="Data Center" description="Nhập, kiểm tra hợp lệ, xác minh và theo dõi nguồn gốc kết quả quay. Không có dữ liệu lịch sử dựng sẵn." />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'sync', label: 'Đồng bộ tự động' },
          { value: 'draws', label: 'Kết quả quay' },
          { value: 'import', label: 'Nhập dữ liệu' },
          { value: 'manual', label: 'Nhập tay' },
          { value: 'jobs', label: 'Lịch sử nhập' },
          { value: 'sources', label: 'Nguồn dữ liệu' },
        ]}
      />
      {tab === 'sync' && <SyncTab />}
      {tab === 'draws' && <DrawsTab />}
      {tab === 'import' && <ImportTab />}
      {tab === 'manual' && <ManualTab />}
      {tab === 'jobs' && <JobsTab />}
      {tab === 'sources' && <SourcesTab />}
    </>
  );
}
