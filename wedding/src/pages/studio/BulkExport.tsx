import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  ImageDown,
  Link2,
  Loader2,
  RotateCw,
  Share2,
  Sheet,
  Square,
  SquareCheck,
  TriangleAlert,
} from 'lucide-react';
import { useStudio } from '../../components/studio/StudioContext';
import { PageHeader, Panel } from '../../components/studio/StudioLayout';
import { Button, ButtonLink } from '../../components/ui/Button';
import { SearchInput, Segmented } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import type { Guest } from '../../data/types';
import { api, inviteUrl } from '../../lib/api';
import { copyText, relTime } from '../../lib/clipboard';
import { downloadGuestList } from '../../lib/excel';
import { downloadBlob, EXPORT_H, EXPORT_W, fileNameFor, renderInvitationPng, shareFile, warmUp, zipBlobs } from '../../lib/exporter';
import { cx } from '../../lib/format';
import { defaultMessage, fillTemplate, messageVariables, variablesFor } from '../../lib/template';

type Tab = 'link' | 'png';

export default function BulkExport() {
  const { guests, selected, setSelected, dirty } = useStudio();
  const [tab, setTab] = useState<Tab>('link');
  const chosen = useMemo(() => guests.filter((g) => selected.includes(g.guest_id)), [guests, selected]);

  return (
    <>
      <PageHeader
        eyebrow="Send & Export"
        title="Gửi & xuất thiệp"
        description="Hai cách gửi cho từng khách: link thiệp riêng (khách mở trên điện thoại), hoặc ảnh PNG 1080 × 1920 riêng từng người."
      >
        <Segmented
          className="mt-6"
          value={tab}
          onChange={setTab}
          options={[
            {
              value: 'link',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Link2 className="size-3.5" /> Phương án 1 · Gửi link
                </span>
              ),
            },
            {
              value: 'png',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <ImageDown className="size-3.5" /> Phương án 2 · Xuất ảnh
                </span>
              ),
            },
          ]}
        />
      </PageHeader>

      {dirty && (
        <div className="mx-4 mt-6 flex items-start gap-2 rounded-2xl border border-burgundy-600/15 bg-rose-soft/60 px-4 py-3 text-[13px] text-burgundy-700 sm:mx-8">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Thiết kế có thay đổi chưa lưu. Link và ảnh dùng <b>bản đã lưu</b> —{' '}
            <ButtonLink to="/studio/thiet-ke" size="sm" variant="ghost" className="h-auto px-1 underline">
              mở Designer để lưu
            </ButtonLink>
          </span>
        </div>
      )}

      {!guests.length ? (
        <div className="px-4 py-10 sm:px-8">
          <Panel className="px-6 py-14 text-center">
            <p className="font-serif text-[26px] text-burgundy-800">Chưa có khách mời</p>
            <p className="mt-2 text-[13.5px] text-espresso-soft">Thêm khách hoặc nhập Excel trước khi gửi thiệp.</p>
            <ButtonLink to="/studio/khach-moi" variant="primary" className="mt-5">
              Đến danh sách khách
            </ButtonLink>
          </Panel>
        </div>
      ) : (
        <div className="grid gap-6 px-4 py-8 sm:px-8 xl:grid-cols-12">
          <div className="xl:col-span-4">
            <GuestPicker guests={guests} selected={selected} setSelected={setSelected} />
          </div>
          <div className="min-w-0 xl:col-span-8">{tab === 'link' ? <LinkTab chosen={chosen} /> : <PngTab chosen={chosen} />}</div>
        </div>
      )}
    </>
  );
}

function GuestPicker({ guests, selected, setSelected }: { guests: Guest[]; selected: string[]; setSelected: React.Dispatch<React.SetStateAction<string[]>> }) {
  const [q, setQ] = useState('');
  const k = q.trim().toLocaleLowerCase('vi');
  const list = guests.filter((g) => !k || [g.guest_id, g.display_name, g.guest_group].some((v) => v.toLocaleLowerCase('vi').includes(k)));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const groups = [...new Set(guests.map((g) => g.guest_group).filter(Boolean))];
  return (
    <Panel className="flex max-h-[78dvh] flex-col overflow-hidden xl:sticky xl:top-6">
      <div className="space-y-3 border-b border-espresso/8 p-4">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-espresso">
            Đã chọn <b className="text-burgundy-700">{selected.length}</b> / {guests.length} khách
          </p>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setSelected(guests.map((g) => g.guest_id))}>
              Tất cả
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              Bỏ chọn
            </Button>
          </div>
        </div>
        <SearchInput placeholder="Tìm khách…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm khách" />
        {groups.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {groups.map((gr) => (
              <button
                key={gr}
                onClick={() => setSelected(guests.filter((g) => g.guest_group === gr).map((g) => g.guest_id))}
                className="rounded-full border border-espresso/12 bg-white/60 px-2.5 py-1 text-[11.5px] text-espresso-soft hover:text-burgundy-700"
              >
                Chỉ {gr}
              </button>
            ))}
          </div>
        )}
      </div>
      <ul className="scrollbar-thin flex-1 overflow-y-auto p-2">
        {list.map((g) => {
          const on = selected.includes(g.guest_id);
          return (
            <li key={g.guest_id}>
              <button onClick={() => toggle(g.guest_id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/70" aria-pressed={on}>
                {on ? <SquareCheck className="size-4 shrink-0 text-burgundy-700" /> : <Square className="size-4 shrink-0 text-espresso-soft/50" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-espresso">{g.display_name}</span>
                  <span className="block truncate text-[11px] text-espresso-soft">
                    {g.guest_id}
                    {g.guest_group ? ` · ${g.guest_group}` : ''}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ——————————————— PHƯƠNG ÁN 1: LINK ——————————————— */

function LinkTab({ chosen }: { chosen: Guest[] }) {
  const { upsertGuests, guests } = useStudio();
  const toast = useToast();
  const [tpl, setTpl] = useState(() => {
    try {
      return localStorage.getItem('hm.messageTemplate') || defaultMessage;
    } catch {
      return defaultMessage;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('hm.messageTemplate', tpl);
    } catch {
      /* bỏ qua */
    }
  }, [tpl]);
  const area = useRef<HTMLTextAreaElement>(null);
  const sample = chosen[0];
  const preview = sample ? fillTemplate(tpl, variablesFor(sample)) : null;
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;

  const markSent = (ids: string[]) => {
    const fresh = ids.filter((id) => !guests.find((g) => g.guest_id === id)?.link_sent_at);
    if (fresh.length) api.markSent(fresh).then(upsertGuests).catch(() => undefined);
  };

  const message = (g: Guest) => fillTemplate(tpl, variablesFor(g));

  const copyMsg = async (g: Guest) => {
    const m = message(g);
    if (m.missing.length) return toast({ kind: 'warning', title: 'Lời nhắn còn biến chưa thay', body: m.missing.map((k) => `{{${k}}}`).join(', ') });
    if (await copyText(m.text)) {
      toast({ kind: 'success', title: 'Đã sao chép lời mời', body: `Dán vào Zalo / Messenger cho ${g.display_name}` });
      markSent([g.guest_id]);
    }
  };
  const copyLink = async (g: Guest) => {
    if (await copyText(inviteUrl(g))) {
      toast({ kind: 'success', title: 'Đã sao chép link', body: g.display_name });
      markSent([g.guest_id]);
    }
  };
  const share = async (g: Guest) => {
    const m = message(g);
    try {
      await navigator.share({ title: `Thiệp mời — ${g.display_name}`, text: m.text });
      markSent([g.guest_id]);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast({ kind: 'warning', title: 'Không chia sẻ được', body: (e as Error).message });
    }
  };
  const copyAll = async () => {
    const bad = chosen.filter((g) => message(g).missing.length);
    if (bad.length) return toast({ kind: 'warning', title: `${bad.length} lời nhắn còn biến chưa thay`, body: 'Kiểm tra lại mẫu lời nhắn.' });
    const text = chosen.map((g) => `— ${g.display_name} (${g.guest_id}) —\n${message(g).text}`).join('\n\n');
    if (await copyText(text)) {
      toast({ kind: 'success', title: `Đã sao chép ${chosen.length} lời mời` });
      markSent(chosen.map((g) => g.guest_id));
    }
  };

  const insertVar = (k: string) => {
    const el = area.current;
    const token = `{{${k}}}`;
    if (!el) return setTpl((t) => t + token);
    const { selectionStart: a, selectionEnd: b } = el;
    setTpl((t) => t.slice(0, a) + token + t.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    });
  };

  return (
    <div className="space-y-6">
      <Panel className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-serif text-[24px] text-burgundy-800">Lời nhắn kèm link</p>
            <p className="mt-1 text-[13px] text-espresso-soft">Mỗi khách nhận một link riêng — mở ra là thiệp có tên của chính họ. Link không chứa tên khách.</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setTpl(defaultMessage)}>
            Khôi phục mẫu
          </Button>
        </div>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div>
            <textarea
              ref={area}
              value={tpl}
              onChange={(e) => setTpl(e.target.value)}
              rows={8}
              aria-label="Mẫu lời nhắn"
              className="w-full rounded-xl border border-espresso/12 bg-white/70 px-3.5 py-3 text-[13.5px] leading-relaxed text-espresso focus:border-burgundy-600/50 focus:outline-none"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {messageVariables.map((v) => (
                <button
                  key={v.key}
                  onClick={() => insertVar(v.key)}
                  title={v.label}
                  className="rounded-full border border-champagne/60 bg-ivory px-2.5 py-1 font-mono text-[11px] text-champagne-deep hover:bg-champagne/10"
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[12px] font-medium text-espresso-soft">Xem trước {sample ? `— ${sample.display_name}` : ''}</p>
            <div className="mt-1.5 rounded-2xl rounded-tl-sm bg-[#e7f0ff] px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap text-[#1f2a3d]">
              {preview ? preview.text : 'Chọn ít nhất một khách để xem trước.'}
            </div>
            {preview && preview.missing.length > 0 && (
              <p className="mt-2 text-[12.5px] text-burgundy-600">Biến chưa thay được: {preview.missing.map((k) => `{{${k}}}`).join(', ')}</p>
            )}
          </div>
        </div>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-espresso">{chosen.length} khách được chọn</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Sheet className="size-3.5" />} disabled={!chosen.length} onClick={() => downloadGuestList(chosen)}>
            Tải Excel danh sách link
          </Button>
          <Button size="sm" variant="primary" icon={<Copy className="size-3.5" />} disabled={!chosen.length} onClick={copyAll}>
            Sao chép tất cả lời mời
          </Button>
        </div>
      </div>

      <Panel className="divide-y divide-espresso/6 overflow-hidden">
        {chosen.map((g) => (
          <div key={g.guest_id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium text-espresso">{g.display_name}</p>
              <p className="truncate font-mono text-[11.5px] text-espresso-soft">{inviteUrl(g)}</p>
              <p className="mt-0.5 text-[11.5px]">
                {g.opened_at ? (
                  <span className="text-[#3d5a3a]">
                    Đã mở {g.open_count} lần · lần cuối {relTime(g.last_opened_at)}
                  </span>
                ) : g.link_sent_at ? (
                  <span className="text-champagne-deep">Đã gửi {relTime(g.link_sent_at)} · chưa mở</span>
                ) : (
                  <span className="text-espresso-soft/70">Chưa gửi</span>
                )}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <Button size="sm" variant="primary" icon={<Copy className="size-3.5" />} onClick={() => copyMsg(g)}>
                Lời mời
              </Button>
              <Button size="sm" variant="secondary" icon={<Link2 className="size-3.5" />} onClick={() => copyLink(g)}>
                Link
              </Button>
              {canShare && (
                <Button size="sm" variant="secondary" icon={<Share2 className="size-3.5" />} onClick={() => share(g)}>
                  Gửi
                </Button>
              )}
              <a
                href={`${inviteUrl(g)}?xem-thu=1`}
                target="_blank"
                rel="noreferrer"
                title="Mở thử (không tính lượt mở)"
                className="grid size-8 place-items-center rounded-full text-espresso-soft hover:bg-beige/70"
              >
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>
        ))}
        {!chosen.length && <p className="px-6 py-10 text-center text-[13.5px] text-espresso-soft">Chọn khách ở cột bên trái.</p>}
      </Panel>
    </div>
  );
}

/* ——————————————— PHƯƠNG ÁN 2: ẢNH PNG ——————————————— */

interface Result {
  guest: Guest;
  status: 'pending' | 'running' | 'done' | 'failed';
  blob?: Blob;
  url?: string;
  error?: string;
}

function PngTab({ chosen }: { chosen: Guest[] }) {
  const { savedDesign, upsertGuests } = useStudio();
  const toast = useToast();
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const [zipping, setZipping] = useState(false);
  const cancel = useRef(false);
  const canShareFiles = typeof navigator !== 'undefined' && !!navigator.canShare;

  useEffect(() => () => results.forEach((r) => r.url && URL.revokeObjectURL(r.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const done = results.filter((r) => r.status === 'done');
  const failed = results.filter((r) => r.status === 'failed');
  const finished = done.length + failed.length;
  const pct = results.length ? Math.round((finished / results.length) * 100) : 0;
  const phase = running ? 'processing' : !results.length ? 'ready' : failed.length ? 'failed' : 'success';

  const process = async (targets: Guest[]) => {
    if (!targets.length) return;
    cancel.current = false;
    setRunning(true);
    const ids = new Set(targets.map((g) => g.guest_id));
    setResults((cur) => {
      const keep = cur.filter((r) => !ids.has(r.guest.guest_id));
      cur.filter((r) => ids.has(r.guest.guest_id) && r.url).forEach((r) => URL.revokeObjectURL(r.url!));
      return [...keep, ...targets.map((guest) => ({ guest, status: 'pending' as const }))];
    });
    const ok: string[] = [];
    const bad: string[] = [];
    try {
      await warmUp(savedDesign);
      for (const g of targets) {
        if (cancel.current) break;
        setResults((cur) => cur.map((r) => (r.guest.guest_id === g.guest_id ? { ...r, status: 'running' } : r)));
        try {
          const blob = await renderInvitationPng(g.display_name, savedDesign);
          const url = URL.createObjectURL(blob);
          ok.push(g.guest_id);
          setResults((cur) => cur.map((r) => (r.guest.guest_id === g.guest_id ? { ...r, status: 'done', blob, url } : r)));
        } catch (e) {
          bad.push(g.guest_id);
          setResults((cur) => cur.map((r) => (r.guest.guest_id === g.guest_id ? { ...r, status: 'failed', error: (e as Error).message } : r)));
        }
        // Nhường luồng cho trình duyệt giữa các ảnh để giao diện không bị treo.
        await new Promise((r) => setTimeout(r, 16));
      }
      if (cancel.current) setResults((cur) => cur.filter((r) => r.status !== 'pending'));
    } finally {
      setRunning(false);
    }
    try {
      if (ok.length) upsertGuests(await api.setStatus(ok, 'exported'));
      if (bad.length) upsertGuests(await api.setStatus(bad, 'error'));
    } catch {
      /* trạng thái chỉ để theo dõi — không chặn tải ảnh */
    }
    toast({ kind: bad.length ? 'warning' : 'success', title: `Đã xuất ${ok.length} thiệp`, body: bad.length ? `${bad.length} thiệp lỗi — bấm “Xuất lại ảnh lỗi”.` : 'Tải từng ảnh hoặc cả gói ZIP.' });
  };

  const downloadZip = async () => {
    setZipping(true);
    try {
      const blob = await zipBlobs(done.map((r) => ({ name: fileNameFor(r.guest), blob: r.blob! })));
      downloadBlob(blob, `thiep-cuoi-HM-${done.length}-khach.zip`);
    } catch (e) {
      toast({ kind: 'warning', title: 'Không tạo được ZIP', body: (e as Error).message });
    } finally {
      setZipping(false);
    }
  };

  const shareOne = async (r: Result) => {
    try {
      const ok = await shareFile(r.blob!, fileNameFor(r.guest));
      if (!ok) downloadBlob(r.blob!, fileNameFor(r.guest));
    } catch (e) {
      toast({ kind: 'warning', title: 'Không chia sẻ được', body: (e as Error).message });
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="p-6">
          <dl className="divide-y divide-espresso/6 text-[13.5px]">
            {[
              ['Khách được chọn', `${chosen.length}`],
              ['Mẫu thiệp', savedDesign.templateName],
              ['Kích thước ảnh', `${EXPORT_W} × ${EXPORT_H} px · 9:16`],
              ['Định dạng', 'PNG'],
              ['Tên file', chosen[0] ? fileNameFor(chosen[0]) : 'HM-0001_ten-khach.png'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <dt className="shrink-0 text-espresso-soft">{k}</dt>
                <dd className="truncate text-right font-medium text-espresso">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel className="p-6">
          <div className="flex items-end justify-between">
            <p className="font-serif text-[34px] leading-none text-burgundy-800">{pct}%</p>
            <p className="text-[12.5px] text-espresso-soft">
              {finished} / {results.length || chosen.length} thiệp ·{' '}
              {phase === 'ready' ? 'Sẵn sàng' : phase === 'processing' ? 'Đang xử lý' : phase === 'success' ? 'Thành công' : 'Có ảnh lỗi'}
            </p>
          </div>
          <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-espresso/8">
            <div className={cx('h-full rounded-full transition-[width] duration-500', failed.length ? 'bg-burgundy-500' : 'bg-burgundy-700')} style={{ width: `${pct}%` }} />
            {running && <div className="animate-shimmer absolute inset-0" />}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
            <p className="flex items-center gap-1.5 text-[#3d5a3a]">
              <CheckCircle2 className="size-3.5" /> Thành công: {done.length}
            </p>
            <p className={cx('flex items-center gap-1.5', failed.length ? 'text-burgundy-600' : 'text-espresso-soft')}>
              <AlertCircle className="size-3.5" /> Thất bại: {failed.length}
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {running ? (
              <Button size="sm" variant="secondary" onClick={() => (cancel.current = true)}>
                Dừng
              </Button>
            ) : (
              <Button size="sm" variant="primary" icon={<ImageDown className="size-3.5" />} disabled={!chosen.length} onClick={() => process(chosen)}>
                Xuất {chosen.length} thiệp
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={<Archive className="size-3.5" />} disabled={running || zipping || !done.length} onClick={downloadZip}>
              {zipping ? 'Đang nén…' : `Tải ZIP (${done.length})`}
            </Button>
            {failed.length > 0 && !running && (
              <Button size="sm" variant="secondary" icon={<RotateCw className="size-3.5" />} onClick={() => process(failed.map((r) => r.guest))}>
                Xuất lại ảnh lỗi
              </Button>
            )}
          </div>
        </Panel>
      </div>

      {results.length > 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {results.map((r) => (
            <li key={r.guest.guest_id} className="rounded-2xl border border-espresso/8 bg-white/70 p-2.5">
              <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-beige/50">
                {r.url && <img src={r.url} alt={`Thiệp của ${r.guest.display_name}`} className="size-full object-cover" />}
                {(r.status === 'pending' || r.status === 'running') && (
                  <div className="absolute inset-0 grid place-items-center">
                    {r.status === 'running' ? <Loader2 className="size-6 animate-spin text-burgundy-700" /> : <span className="text-[11.5px] text-espresso-soft">Đang chờ</span>}
                  </div>
                )}
                {r.status === 'failed' && (
                  <div className="absolute inset-0 grid place-items-center bg-burgundy-900/80 p-3 text-center text-[11.5px] text-ivory">
                    <span>
                      <AlertCircle className="mx-auto mb-1 size-5" />
                      {r.error}
                    </span>
                  </div>
                )}
              </div>
              <p className="mt-2 truncate px-0.5 text-[12.5px] font-medium text-espresso" title={r.guest.display_name}>
                {r.guest.display_name}
              </p>
              <div className="mt-1 flex items-center justify-between gap-1 px-0.5">
                <span className="truncate font-mono text-[11px] text-espresso-soft">{r.guest.guest_id}</span>
                {r.status === 'done' && (
                  <span className="flex shrink-0">
                    {canShareFiles && (
                      <button onClick={() => shareOne(r)} title="Gửi ảnh (Zalo, Messenger…)" className="grid size-7 place-items-center rounded-full text-espresso-soft hover:bg-beige">
                        <Share2 className="size-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => downloadBlob(r.blob!, fileNameFor(r.guest))}
                      title={`Tải ${fileNameFor(r.guest)}`}
                      className="grid size-7 place-items-center rounded-full text-espresso-soft hover:bg-beige"
                    >
                      <Download className="size-3.5" />
                    </button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Panel className="px-6 py-12 text-center text-[13.5px] leading-relaxed text-espresso-soft">
          Bấm <b className="text-espresso">Xuất {chosen.length} thiệp</b> để tạo ảnh. Ảnh được tạo ngay trên trình duyệt này, kiểm tra tên khách trước khi chụp, và hiển thị
          tại đây để bạn soát lại từng tấm.
        </Panel>
      )}
    </div>
  );
}
