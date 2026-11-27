import { useEffect, useState } from 'react';
import type { Game, PrizeTier } from '../../shared/game';
import { apiFetch, ApiClientError, getToken, setToken } from '../lib/api';
import { useGame } from '../lib/game';
import { useApi } from '../lib/hooks';
import { dateTime, oneIn, vnd } from '../lib/format';
import { Badge, Button, Card, ErrorState, Field, Input, LoadingBlock, Notice, PageHeader, Select, Table, Td } from '../components/ui';
import { useToast } from '../components/toast';

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : 'Có lỗi xảy ra');

function GameConfig({ game, onSaved }: { game: Game; onSaved: () => void }) {
  const toast = useToast();
  const prob = useApi<any>(`/games/${game.code}/probability`);
  const [tiers, setTiers] = useState<PrizeTier[]>(game.prizeTiers);
  const [meta, setMeta] = useState({ url: game.rulesSourceUrl ?? '', status: game.rulesVerificationStatus, note: game.rulesNote ?? '', schedule: game.scheduleNote ?? '', price: game.ticketPrice });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTiers(game.prizeTiers);
    setMeta({ url: game.rulesSourceUrl ?? '', status: game.rulesVerificationStatus, note: game.rulesNote ?? '', schedule: game.scheduleNote ?? '', price: game.ticketPrice });
  }, [game]);
  const save = async () => {
    setBusy(true);
    try {
      await apiFetch(`/admin/games/${game.id}`, { method: 'PUT', body: { prizeTiers: tiers, rulesSourceUrl: meta.url || null, rulesVerificationStatus: meta.status, rulesNote: meta.note || null, scheduleNote: meta.schedule || null, ticketPrice: meta.price } });
      toast('success', 'Đã lưu cấu hình game (có audit log)');
      onSaved();
      prob.reload();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const probOf = (code: string) => prob.data?.tiers.find((t: any) => t.code === code);
  return (
    <Card title={`Cấu hình game: ${game.name}`} subtitle={`Số chính ${game.mainMin}–${game.mainMax}, chọn ${game.mainPicks}; số đặc biệt: ${game.specialMode === 'separate_pool' ? `${game.specialMin}–${game.specialMax} (người chơi chọn)` : game.specialMode === 'bonus_from_main' ? 'quay thêm từ số chính còn lại' : 'không có'}`}>
      {game.rulesVerificationStatus !== 'verified' && (
        <Notice tone="warn">Thể lệ CHƯA XÁC MINH. Vui lòng đối chiếu với thể lệ chính thức trên vietlott.vn (tên hạng giải, điều kiện trùng khớp, giá trị giải, giá vé), cập nhật nếu cần, rồi chuyển trạng thái sang “Đã xác minh”.</Notice>
      )}
      <div className="mt-4">
        <Table head={['Hạng', 'Điều kiện', 'Loại', 'Giá trị (VND)', 'Xác suất / vé']}>
          {tiers.map((t, i) => (
            <tr key={t.code}>
              <Td>{t.name}</Td>
              <Td className="text-xs">
                {t.mainMatches} số {t.specialMatch === true ? '+ số đặc biệt' : t.specialMatch === false ? '(không trùng ĐB)' : ''}
              </Td>
              <Td>{t.kind === 'jackpot' ? <Badge tone="warn">Jackpot{t.shared ? ' · chia giải' : ''}</Badge> : <Badge>Cố định</Badge>}</Td>
              <Td>
                <Input type="number" min={0} aria-label={`Giá trị ${t.name}`} value={t.amount} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} className="w-40" />
              </Td>
              <Td className="measured text-xs">{probOf(t.code) ? `${oneIn(probOf(t.code).oneIn)} (${probOf(t.code).exact})` : '—'}</Td>
            </tr>
          ))}
        </Table>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Giá vé (VND)">
          <Input type="number" min={1} value={meta.price} onChange={(e) => setMeta({ ...meta, price: Number(e.target.value) })} />
        </Field>
        <Field label="URL thể lệ chính thức">
          <Input value={meta.url} onChange={(e) => setMeta({ ...meta, url: e.target.value })} />
        </Field>
        <Field label="Lịch quay">
          <Input value={meta.schedule} onChange={(e) => setMeta({ ...meta, schedule: e.target.value })} />
        </Field>
        <Field label="Trạng thái thể lệ">
          <Select value={meta.status} onChange={(e) => setMeta({ ...meta, status: e.target.value as Game['rulesVerificationStatus'] })}>
            <option value="unverified">Chưa xác minh</option>
            <option value="verified">Đã xác minh với nguồn chính thức</option>
          </Select>
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Ghi chú thể lệ">
          <Input value={meta.note} onChange={(e) => setMeta({ ...meta, note: e.target.value })} />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" loading={busy} onClick={save}>
          Lưu cấu hình
        </Button>
        <span className="text-xs text-muted">Xác minh lần cuối: {dateTime(game.rulesVerifiedAt)}</span>
      </div>
      {prob.data && <p className="mt-3 text-xs text-muted">Kỳ vọng tiền thưởng / vé: {vnd(prob.data.expectedValue.expectedPrize)} (≈ {(prob.data.expectedValue.returnRatio * 100).toFixed(1)}% giá vé).</p>}
    </Card>
  );
}

function Budget() {
  const toast = useToast();
  const q = useApi<any>('/settings');
  const [f, setF] = useState({ per: 0, month: 0, year: 0, unverified: false, bingo: 50000, bingoMin: 30 });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setF({ per: Number(q.data.budget_per_draw.value), month: Number(q.data.monthly_budget.value), year: Number(q.data.annual_budget.value), unverified: Boolean(q.data.statistics_include_unverified?.value), bingo: Number(q.data.bingo18_daily_limit?.value ?? 50000), bingoMin: Number(q.data.bingo18_session_minutes?.value ?? 30) });
  }, [q.data]);
  const save = async () => {
    setBusy(true);
    try {
      await apiFetch('/admin/settings', { method: 'PUT', body: { budget_per_draw: f.per, monthly_budget: f.month, annual_budget: f.year, statistics_include_unverified: f.unverified, bingo18_daily_limit: f.bingo, bingo18_session_minutes: f.bingoMin } });
      toast('success', 'Đã lưu hạn mức');
      q.reload();
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingBlock />;
  return (
    <Card title="Ngân sách & hạn mức" subtitle="Ràng buộc: ngân sách/kỳ ≤ hạn mức tháng ≤ hạn mức năm. Mọi thay đổi được ghi audit.">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Ngân sách mỗi kỳ (VND)">
          <Input type="number" min={0} step={10000} value={f.per} onChange={(e) => setF({ ...f, per: Number(e.target.value) })} />
        </Field>
        <Field label="Hạn mức tháng (VND)">
          <Input type="number" min={0} step={10000} value={f.month} onChange={(e) => setF({ ...f, month: Number(e.target.value) })} />
        </Field>
        <Field label="Hạn mức năm (VND)">
          <Input type="number" min={0} step={10000} value={f.year} onChange={(e) => setF({ ...f, year: Number(e.target.value) })} />
        </Field>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Hạn mức Bingo18 mỗi ngày (VND)">
          <Input type="number" min={0} step={10000} value={f.bingo} onChange={(e) => setF({ ...f, bingo: Number(e.target.value) })} />
        </Field>
        <Field label="Giới hạn phiên Bingo18 (phút)">
          <Input type="number" min={5} max={600} value={f.bingoMin} onChange={(e) => setF({ ...f, bingoMin: Number(e.target.value) })} />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" className="h-4 w-4 accent-accent" checked={f.unverified} onChange={(e) => setF({ ...f, unverified: e.target.checked })} />
        Thống kê mặc định bao gồm dữ liệu chưa xác minh
      </label>
      <Button className="mt-4" variant="primary" loading={busy} disabled={f.per > f.month || f.month > f.year} onClick={save}>
        Lưu hạn mức
      </Button>
    </Card>
  );
}

function Access() {
  const toast = useToast();
  const [t, setT] = useState(getToken() ?? '');
  const health = useApi<any>('/health');
  return (
    <Card title="Truy cập & hệ thống">
      <p className="text-xs text-muted">Ở production, đăng nhập bằng Cloudflare Access. API token chỉ dùng cho tự động hoá hoặc khi Access chưa được cấu hình; token được lưu trong trình duyệt này.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Field label="API token">
          <Input type="password" autoComplete="off" value={t} onChange={(e) => setT(e.target.value)} className="w-72" />
        </Field>
        <Button
          onClick={() => {
            setToken(t.trim() || null);
            toast('success', t.trim() ? 'Đã lưu token — đang tải lại' : 'Đã xoá token');
            setTimeout(() => location.reload(), 400);
          }}
        >
          Lưu
        </Button>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <dt className="text-muted">Trạng thái API</dt>
        <dd>{health.data ? <Badge tone={health.data.status === 'ok' ? 'good' : 'bad'}>{health.data.status}</Badge> : '—'}</dd>
        <dt className="text-muted">Phiên bản</dt>
        <dd>{(health.data as any)?.version ?? '—'}</dd>
      </dl>
    </Card>
  );
}

export default function SettingsPage() {
  const { game, reload } = useGame();
  return (
    <>
      <PageHeader title="Cài đặt" description="Cấu hình trò chơi (lấy từ database, không hardcode), hạn mức vốn và truy cập." />
      <div className="space-y-5">
        {game ? <GameConfig game={game} onSaved={reload} /> : <LoadingBlock />}
        <div className="grid gap-5 lg:grid-cols-2">
          <Budget />
          <Access />
        </div>
        <Card title="Tuyên bố">
          <p className="text-xs leading-relaxed text-muted">
            QUANTUM FULL là công cụ nghiên cứu xác suất và quản lý ngân sách. Kết quả xổ số là ngẫu nhiên; không thuật toán nào bảo đảm trúng thưởng. Kỳ vọng toán học của mỗi vé là âm. Hệ thống không mua vé, không liên kết với Vietlott, và
            không tạo dữ liệu lịch sử giả.
          </p>
        </Card>
      </div>
    </>
  );
}
