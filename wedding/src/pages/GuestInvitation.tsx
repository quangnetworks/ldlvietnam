import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Download, Images, MailOpen } from 'lucide-react';
import { InteractiveInvitation } from '../components/invitation/InteractiveInvitation';
import { CARD_H, CARD_W, InvitationCard } from '../components/invitation/InvitationCard';
import { normalizeDesign } from '../components/studio/StudioContext';
import { Monogram } from '../components/ui/Monogram';
import { ScaledFrame } from '../components/ui/ScaledFrame';
import { defaultDesign, type InvitationDesign } from '../data/design';
import { resolveTheme, themeStyle } from '../data/themes';
import { demoGuests } from '../data/demo';
import { api } from '../lib/api';
import { downloadBlob, fileNameFor, renderInvitationPng, shareFile } from '../lib/exporter';
import { cx } from '../lib/format';

/**
 * Trang dành cho người nhận thiệp — không có thành phần quản trị.
 * /t/<mã link>         : thiệp riêng của từng khách (dữ liệu từ máy chủ)
 * /thiep?khach=HM-0001 : bản minh họa với khách mẫu
 * ?che-do=tinh         : mở thẳng thiệp tĩnh 9:16
 */
export default function GuestInvitation() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const [state, setState] = useState<{ name: string; salutation: string; design: InvitationDesign; id: string } | 'loading' | 'missing'>(() => {
    if (token) return 'loading';
    const demo = demoGuests.find((g) => g.guest_id === params.get('khach'));
    return { name: demo?.display_name ?? 'Quý Khách', salutation: demo?.salutation ?? '', design: { ...defaultDesign, palette: resolveTheme(params.get('chu-de') ?? undefined).id }, id: demo?.guest_id ?? 'HM-DEMO' };
  });
  const [mode, setMode] = useState<'interactive' | 'static'>(params.get('che-do') === 'tinh' ? 'static' : 'interactive');

  useEffect(() => {
    if (!token) return;
    api
      .invite(token, params.get('xem-thu') === '1')
      .then((r) => setState({ name: r.display_name, salutation: r.salutation ?? '', design: normalizeDesign(r.design), id: token }))
      .catch(() => setState('missing'));
  }, [token, params]);

  useEffect(() => {
    if (typeof state === 'object') document.title = `Thiệp mời — ${state.name}`;
  }, [state]);

  if (state === 'loading')
    return (
      <div className="velvet grid min-h-dvh place-items-center">
        <Monogram className="size-20 animate-pulse text-[80px]" />
      </div>
    );
  if (state === 'missing')
    return (
      <div className="velvet grid min-h-dvh place-items-center px-6 text-center text-ivory">
        <div>
          <Monogram className="mx-auto size-20 text-[80px]" />
          <p className="mt-6 font-serif text-[28px]">Không tìm thấy thiệp</p>
          <p className="mx-auto mt-2 max-w-xs text-[14px] text-ivory/75">Link có thể đã thay đổi. Vui lòng liên hệ gia đình để nhận lại link thiệp.</p>
          <Link to="/" className="mt-6 inline-block text-[13px] text-champagne-light underline">
            Xem website cưới
          </Link>
        </div>
      </div>
    );

  return (
    <div style={themeStyle(state.design.palette)}>
      {mode === 'interactive' ? <InteractiveInvitation guestName={state.name} salutation={state.salutation} design={state.design} /> : <StaticView name={state.name} salutation={state.salutation} design={state.design} id={state.id} />}
      <div className="fixed bottom-[max(14px,env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2">
        <div className="flex rounded-full border border-champagne-light/30 bg-burgundy-900/70 p-1 text-[12.5px] text-ivory shadow-lg backdrop-blur">
          {(
            [
              ['interactive', 'Thiệp mời', MailOpen],
              ['static', 'Ảnh thiệp', Images],
            ] as const
          ).map(([v, l, Icon]) => (
            <button
              key={v}
              onClick={() => {
                setMode(v);
                window.scrollTo({ top: 0 });
              }}
              className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 transition-colors', mode === v ? 'bg-ivory text-burgundy-800' : 'text-ivory/80 hover:text-ivory')}
            >
              <Icon className="size-3.5" /> {l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StaticView({ name, salutation, design, id }: { name: string; salutation: string; design: InvitationDesign; id: string }) {
  const [w, setW] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const fit = () => setW(Math.min(window.innerWidth - 32, ((window.innerHeight - 120) * CARD_W) / CARD_H, CARD_W * 1.25));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      const blob = await renderInvitationPng(name, design, salutation);
      const file = fileNameFor({ guest_id: id.startsWith('HM') ? id : 'thiep', display_name: name });
      if (!(await shareFile(blob, file).catch(() => false))) downloadBlob(blob, file);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="velvet flex min-h-dvh flex-col items-center justify-center gap-4 p-4 pb-20">
      <div style={{ width: w }} className="shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)]">
        {w > 0 && (
          <ScaledFrame>
            <InvitationCard guestName={name} salutation={salutation} design={design} />
          </ScaledFrame>
        )}
      </div>
      <button
        onClick={save}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-full border border-champagne-light/40 px-4 py-2 text-[13px] text-ivory hover:bg-ivory hover:text-burgundy-800 disabled:opacity-60"
      >
        <Download className="size-4" /> {busy ? 'Đang tạo ảnh…' : 'Lưu ảnh thiệp'}
      </button>
    </div>
  );
}
