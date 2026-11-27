import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Play, Square } from 'lucide-react';
import { apiFetch, ApiClientError } from '../lib/api';
import { useApi } from '../lib/hooks';
import { dateTime, num, vnd } from '../lib/format';
import { Badge, Button, Card, ErrorState, Field, Input, Kpi, LoadingBlock, Notice, RecordLead, Select, Table, Td } from './ui';
import { useToast } from './toast';

const BETS: { value: string; label: string }[] = [
  ...[1, 2, 3, 4, 5, 6].map((v) => ({ value: `single:${v}`, label: `Chọn số ${v} (hoàn 56,9%)` })),
  { value: 'big', label: 'Lớn, tổng 12 đến 18 (hoàn 56,3%)' },
  { value: 'small', label: 'Nhỏ, tổng 3 đến 9 (hoàn 56,3%)' },
];
const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : 'Có lỗi xảy ra');
const mmss = (s: number) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
const parseVnd = (s: string) => Math.round(Number(s.replace(/[^\d]/g, '')));

/** Các kỳ đã quay hôm nay (HH:MM), mới nhất trước — để ghi kết quả. */
function pastSlots(lastDrawAt: string | null, startedAt: string): string[] {
  if (!lastDrawAt) return [];
  const [h, m] = lastDrawAt.split(':').map(Number);
  // Từ kỳ ngay trước lúc mở phiên (giờ Việt Nam) đến kỳ vừa quay.
  const st = new Date(new Date(startedAt).getTime() + 7 * 3600_000);
  const from = Math.max(6 * 60, st.getUTCHours() * 60 + st.getUTCMinutes() - 6);
  const out: string[] = [];
  for (let t = h * 60 + m; t >= from && out.length < 160; t -= 6) out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  return out;
}

function StartForm({ defaults, onStarted }: { defaults: any; onStarted: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ bet: 'single:1', base: '1', budget: '', takeProfit: '', minutes: String(defaults.sessionMinutes) });
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const [type, value] = f.bet.split(':');
      await apiFetch('/bingo18/live/start', {
        body: {
          bet: value ? { type, value: Number(value) } : { type },
          base_units: Number(f.base),
          ...(f.budget.trim() ? { budget: parseVnd(f.budget) } : {}),
          take_profit: f.takeProfit.trim() ? parseVnd(f.takeProfit) : null,
          max_minutes: Number(f.minutes),
        },
      });
      toast('success', 'Đã mở phiên chơi');
      onStarted();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Mở phiên chơi" subtitle={`Đã chi Bingo18 hôm nay ${vnd(defaults.spentToday)} trên hạn mức ${vnd(defaults.dailyLimit)}. Để trống lỗ tối đa thì dùng hạn mức ngày.`}>
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))_auto]">
        <Field label="Cửa cược">
          <Select value={f.bet} onChange={(e) => setF({ ...f, bet: e.target.value })}>
            {BETS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mức gốc (lần × 10.000đ)">
          <Input type="number" min={1} max={100} value={f.base} onChange={(e) => setF({ ...f, base: e.target.value })} />
        </Field>
        <Field label="Lỗ tối đa của phiên (đ)">
          <Input inputMode="numeric" placeholder={String(defaults.dailyLimit)} value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />
        </Field>
        <Field label="Chốt lời khi lãi đạt (đ)">
          <Input inputMode="numeric" placeholder="vd 30000" value={f.takeProfit} onChange={(e) => setF({ ...f, takeProfit: e.target.value })} />
        </Field>
        <Field label="Thời gian phiên (phút)">
          <Input type="number" min={5} max={960} value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} />
        </Field>
        <Button variant="primary" loading={busy} onClick={start}>
          <Play className="h-4 w-4" aria-hidden /> Mở phiên
        </Button>
      </div>
    </Card>
  );
}

function RoundForm({ session, lastDrawAt, recorded, onSaved }: { session: any; lastDrawAt: string | null; recorded: Set<string>; onSaved: () => void }) {
  const toast = useToast();
  const slots = useMemo(() => pastSlots(lastDrawAt, session.startedAt).filter((s) => !recorded.has(s)), [lastDrawAt, session.startedAt, recorded]);
  const [f, setF] = useState({ drawAt: slots[0] ?? '', played: true, stake: String(session.baseUnits * 10000), d: ['', '', ''], prize: '' });
  useEffect(() => setF((x) => ({ ...x, drawAt: slots.includes(x.drawAt) ? x.drawAt : (slots[0] ?? '') })), [slots]);
  const [busy, setBusy] = useState(false);
  const hasDice = f.d.every((x) => x !== '');
  const save = async () => {
    setBusy(true);
    try {
      await apiFetch(`/bingo18/live/${session.id}/round`, {
        body: {
          draw_at: f.drawAt,
          played: f.played,
          ...(f.played ? { stake: parseVnd(f.stake) } : {}),
          ...(f.played && hasDice ? { result: f.d.map(Number) } : {}),
          ...(f.played && !hasDice && f.prize.trim() ? { prize: parseVnd(f.prize) } : {}),
        },
      });
      toast('success', `Đã ghi kỳ ${f.drawAt}`);
      setF((x) => ({ ...x, d: ['', '', ''], prize: '' }));
      onSaved();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  if (!slots.length) return <p className="text-sm text-muted">Chưa có kỳ nào đã quay cần ghi.</p>;
  return (
    <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.4fr)_auto]">
      <Field label="Kỳ">
        <Select value={f.drawAt} onChange={(e) => setF({ ...f, drawAt: e.target.value })}>
          {slots.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Có chơi kỳ này?">
        <Select value={f.played ? 'yes' : 'no'} onChange={(e) => setF({ ...f, played: e.target.value === 'yes' })}>
          <option value="yes">Có chơi</option>
          <option value="no">Không chơi</option>
        </Select>
      </Field>
      <Field label="Tiền chơi (đ)">
        <Input inputMode="numeric" disabled={!f.played} value={f.stake} onChange={(e) => setF({ ...f, stake: e.target.value })} />
      </Field>
      <Field label="Kết quả 3 số (từ tin nhắn Vietlott)">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <Select key={i} aria-label={`Số kết quả thứ ${i + 1}`} disabled={!f.played} value={f.d[i]} onChange={(e) => setF({ ...f, d: f.d.map((x, j) => (j === i ? e.target.value : x)) })} className="measured">
              <option value="">Số</option>
              {[1, 2, 3, 4, 5, 6].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          ))}
        </div>
      </Field>
      <Button variant="primary" loading={busy} disabled={!f.drawAt || (f.played && !hasDice && !f.prize.trim())} onClick={save}>
        Ghi kỳ
      </Button>
      {f.played && !hasDice && (
        <Field label="Hoặc nhập tiền thưởng nhận được (đ)">
          <Input inputMode="numeric" placeholder="0 nếu không trúng" value={f.prize} onChange={(e) => setF({ ...f, prize: e.target.value })} />
        </Field>
      )}
    </div>
  );
}

/** Phiên chơi trực tiếp: mỗi kỳ 6 phút chốt CHƠI hay DỪNG theo lãi/lỗ thực tế và quy tắc dừng cứng. */
export function BingoLiveTab() {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const q = useApi<any>(`/bingo18/live?_=${tick}`);
  const d = q.data;
  const [now, setNow] = useState(Date.now());
  const [notify, setNotify] = useState(false);
  const lastNotified = useRef<string | null>(null);
  const fetchedAt = useMemo(() => Date.now(), [d]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Hết giờ bán kỳ hiện tại ⇒ tải lại phương án cho kỳ kế tiếp; ngoài ra đồng bộ mỗi phút (nhiều thiết bị).
  const left = d?.schedule?.secondsToCutoff != null ? d.schedule.secondsToCutoff - Math.floor((now - fetchedAt) / 1000) : null;
  useEffect(() => {
    if (left != null && left <= 0) setTick((x) => x + 1);
  }, [left != null && left <= 0]);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!notify || !d?.plan || !d.schedule.nextDrawAt || lastNotified.current === d.schedule.nextDrawAt) return;
    lastNotified.current = d.schedule.nextDrawAt;
    try {
      new Notification('Bingo18', { body: d.plan.headline, tag: 'bingo18-live' });
    } catch {
      /* trình duyệt không hỗ trợ: bỏ qua */
    }
  }, [notify, d]);
  const enableNotify = async () => {
    try {
      const p = await Notification.requestPermission();
      setNotify(p === 'granted');
      toast(p === 'granted' ? 'success' : 'error', p === 'granted' ? 'Sẽ nhắc phương án mỗi kỳ khi tab này đang mở' : 'Trình duyệt không cho phép thông báo');
    } catch {
      toast('error', 'Trình duyệt không hỗ trợ thông báo');
    }
  };
  const close = async () => {
    try {
      await apiFetch(`/bingo18/live/${d.session.id}/close`, { body: { reason: d.plan?.action === 'stop' ? d.plan.headline : 'Người chơi kết thúc' } });
      toast('success', 'Đã kết thúc phiên');
      setTick((x) => x + 1);
    } catch (e) {
      toast('error', errMsg(e));
    }
  };
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!d) return <LoadingBlock rows={6} />;
  const s = d.session;
  const open = s && s.status === 'open';
  const recorded = new Set<string>(d.rounds.map((r: any) => r.drawAt));
  let cum = 0;
  return (
    <div className="space-y-5">
      <Notice tone="info">
        Kết quả Bingo18 không tự về theo từng kỳ: nguồn dữ liệu mở chỉ cập nhật lúc 07:00 và 19:00, còn vietlott.vn chặn truy cập tự động. Phương án mỗi kỳ không cần kết quả quay (đoán số không có tác dụng): nó dựa trên lãi/lỗ bạn ghi và các quy tắc dừng. Nhập 3 số từ tin nhắn Vietlott SMS sau mỗi kỳ.
      </Notice>
      {!open && <StartForm defaults={d.defaults} onStarted={() => setTick((x) => x + 1)} />}
      {open && d.plan && (
        <>
          <RecordLead
            badge={<Badge tone={d.plan.action === 'play' ? 'warn' : 'bad'}>{d.plan.action === 'play' ? `Chốt kỳ ${d.schedule.nextDrawAt}` : 'Dừng'}</Badge>}
            headline={d.plan.headline}
            reasons={d.plan.reasons}
            actions={
              <>
                {!notify && (
                  <Button onClick={enableNotify}>
                    <Bell className="h-4 w-4" aria-hidden /> Nhắc mỗi kỳ
                  </Button>
                )}
                <Button variant="danger" onClick={close}>
                  <Square className="h-4 w-4" aria-hidden /> Kết thúc phiên
                </Button>
              </>
            }
            reading={
              d.schedule.nextDrawAt
                ? { label: `Còn lại đến lúc ngừng bán kỳ ${d.schedule.nextDrawAt}`, value: mmss(left ?? 0), note: `Quay lúc ${d.schedule.nextDrawAt}. Phương án tự làm mới khi sang kỳ mới.` }
                : { label: 'Lãi/lỗ của phiên', value: vnd(d.plan.net), tone: d.plan.net >= 0 ? 'good' : 'bad' }
            }
          />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Lãi/lỗ phiên" value={`${d.plan.net >= 0 ? '+' : ''}${vnd(d.plan.net)}`} tone={d.plan.net >= 0 ? 'good' : 'bad'} hint={`Đã chơi ${vnd(d.plan.staked)}, thưởng ${vnd(d.plan.prizes)}`} />
            <Kpi label="Còn được lỗ thêm" value={vnd(Math.max(0, d.plan.lossRoomLeft))} tone="warn" hint={`Lỗ tối đa ${vnd(s.budget)} tính từ đầu phiên`} />
            <Kpi label="Kỳ đã chơi / thắng" value={`${num(d.plan.played)} / ${num(d.plan.wins)}`} hint={`Cửa ${s.betLabel}`} />
            <Kpi label="Thời gian còn" value={`${num(d.plan.minutesLeft)} phút`} hint={`Mở lúc ${dateTime(s.startedAt)}`} />
          </div>
          <Card title="Ghi kết quả kỳ vừa quay" subtitle="Chọn 3 số kết quả, app tự tính tiền thưởng theo cửa cược của phiên và ghi vào sổ quỹ.">
            <RoundForm session={s} lastDrawAt={d.schedule.lastDrawAt} recorded={recorded} onSaved={() => setTick((x) => x + 1)} />
          </Card>
        </>
      )}
      {s && d.rounds.length > 0 && (
        <Card title={`Các kỳ trong phiên #${s.id}${s.status === 'closed' ? ' (đã kết thúc)' : ''}`} subtitle={s.status === 'closed' ? `Kết thúc lúc ${dateTime(s.endedAt)}: ${s.endReason}` : undefined}>
          <Table head={['Kỳ', 'Kết quả', 'Tiền chơi', 'Thưởng', 'Lãi/lỗ lũy kế']}>
            {d.rounds.map((r: any) => {
              cum += r.prize - r.stake;
              return (
                <tr key={r.id}>
                  <Td className="measured text-cool">{r.drawAt}</Td>
                  <Td className="measured">{r.result ? r.result.join('  ') : r.stake > 0 ? 'chưa nhập' : 'không chơi'}</Td>
                  <Td className="measured">{vnd(r.stake)}</Td>
                  <Td className={`measured ${r.prize > r.stake ? 'text-ok' : ''}`}>{vnd(r.prize)}</Td>
                  <Td className={`measured ${cum >= 0 ? 'text-ok' : 'text-bad'}`}>{`${cum >= 0 ? '+' : ''}${vnd(cum)}`}</Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}
    </div>
  );
}
