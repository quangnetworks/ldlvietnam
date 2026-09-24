/**
 * Ứng dụng LDL & thông báo đẩy trên thiết bị này:
 *  - iPhone / iPad: hướng dẫn "Chia sẻ → Thêm vào MH chính", sau đó bật thông báo (iOS 16.4+)
 *  - Windows / macOS / Android (Edge, Chrome): nút "Cài ứng dụng" (cửa sổ riêng, biểu tượng trên taskbar / Start) + bật thông báo
 *  - Số chưa đọc hiện trên biểu tượng ứng dụng (Màn hình chính iPhone, taskbar Windows, Dock macOS)
 * compact: dải nhắc nhỏ ở Trang chủ (có thể ẩn), chỉ hiện khi cần hành động.
 */
import { useEffect, useState } from 'react';
import { BellRing, BellOff, Share, PlusSquare, Smartphone, Monitor, Send, X, CheckCircle2, Download } from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { pushState, enablePush, disablePush, isIOS, isStandalone, isMobileDevice, onInstallChange, promptInstall } from '../push.js';
import { cx } from '../utils.js';

const HIDE_KEY = 'ldl_push_prompt_hidden';

function IosSteps() {
  return (
    <ol className="push-steps">
      <li>Mở trang này bằng <b>Safari</b> trên iPhone (iOS 16.4 trở lên).</li>
      <li>Bấm nút <b>Chia sẻ</b> <Share size={14} className="inline-ico" /> ở thanh dưới.</li>
      <li>Chọn <b>Thêm vào MH chính</b> <PlusSquare size={14} className="inline-ico" /> → <b>Thêm</b>.</li>
      <li>Mở <b>LDL</b> từ biểu tượng trên Màn hình chính, rồi bấm <b>Bật thông báo</b> tại đây.</li>
    </ol>
  );
}

/** Hook: trình duyệt có đang cho phép cài ứng dụng không (Edge / Chrome trên Windows, macOS, Android). */
export function useInstallable() {
  const [can, setCan] = useState(false);
  useEffect(() => onInstallChange(setCan), []);
  return can;
}

export default function PushCard({ compact = false }) {
  const toast = useToast();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const installable = useInstallable();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } });
  useEffect(() => { pushState().then(setState); }, []);
  const mobile = isMobileDevice();
  const where = mobile ? 'điện thoại' : 'máy tính';

  const on = async () => {
    setBusy(true);
    try { await enablePush(); setState('on'); toast('Đã bật thông báo đẩy trên thiết bị này'); } catch (e) { toast(e.message, 'error'); setState(await pushState()); } finally { setBusy(false); }
  };
  const off = async () => {
    setBusy(true);
    try { await disablePush(); setState('off'); toast('Đã tắt thông báo đẩy trên thiết bị này'); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try { await api.post('/push/test'); toast('Đã gửi thử — thông báo sẽ hiện sau vài giây'); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const install = async () => {
    if (await promptInstall()) toast('Đã cài ứng dụng LDL — mở từ biểu tượng trên máy để dùng như ứng dụng');
  };

  if (!state) return null;

  if (compact) {
    const phone = window.matchMedia('(max-width: 800px)').matches;
    const needPush = state === 'off';
    const needIos = state === 'ios-install' && phone;
    if (hidden || (!needPush && !needIos && !installable)) return null;
    const hide = () => { try { localStorage.setItem(HIDE_KEY, '1'); } catch { /* bỏ qua */ } setHidden(true); };
    return (
      <div className="push-banner">
        <span className="push-banner-ico">{installable && !needPush ? <Download size={18} /> : <BellRing size={18} />}</span>
        <div className="grow">
          <b>{needIos ? 'Cài LDL lên iPhone để nhận thông báo' : needPush ? `Nhận thông báo trên ${where}` : 'Cài LDL như một ứng dụng'}</b>
          <small className="block">{needIos
            ? <>Bấm <Share size={12} className="inline-ico" /> Chia sẻ → <b>Thêm vào MH chính</b>, rồi mở LDL từ Màn hình chính.</>
            : needPush ? 'Việc được giao, đề xuất cần duyệt, tin nhắn… hiện ngay cả khi không mở LDL; số chưa đọc hiện trên biểu tượng.'
              : `Mở LDL trong cửa sổ riêng, có biểu tượng trên ${mobile ? 'màn hình chính' : 'thanh taskbar / Start'} kèm số thông báo chưa đọc.`}</small>
        </div>
        {installable && <button className="btn btn-sm" onClick={install}><Download size={14} /> Cài</button>}
        {needPush && <button className="btn btn-sm btn-primary" disabled={busy} onClick={on}>Bật</button>}
        <button className="icon-btn sm" onClick={hide} aria-label="Ẩn"><X size={15} /></button>
      </div>
    );
  }

  return (
    <section className={cx('push-card', state === 'on' && 'on')}>
      <div className="push-card-head">
        <span className="push-banner-ico">{state === 'on' ? <BellRing size={20} /> : state === 'denied' ? <BellOff size={20} /> : mobile ? <Smartphone size={20} /> : <Monitor size={20} />}</span>
        <div className="grow">
          <b>Ứng dụng LDL & thông báo đẩy trên {where} này</b>
          <small className="muted block">
            {state === 'on' && <><CheckCircle2 size={12} className="inline-ico text-green" /> Đang nhận: việc được giao, bình luận, đề xuất cần duyệt, văn bản, tin nhắn 1-1 và nhóm, nhắc tên. Số chưa đọc hiện trên biểu tượng LDL.</>}
            {state === 'off' && `Nhận thông báo như ứng dụng ngay cả khi không mở LDL; số chưa đọc hiện trên biểu tượng ${mobile ? 'ở màn hình chính' : 'trên thanh taskbar'}.`}
            {state === 'denied' && (isIOS() ? 'Thông báo đang bị chặn. Mở Cài đặt → Thông báo → LDL → bật Cho phép thông báo.' : 'Thông báo đang bị chặn. Bấm biểu tượng ổ khoá cạnh địa chỉ trang (hoặc Cài đặt ứng dụng) → Thông báo → Cho phép.')}
            {state === 'ios-install' && 'Trên iPhone, thông báo đẩy và số trên biểu tượng chỉ hoạt động khi LDL được thêm vào Màn hình chính:'}
            {state === 'unsupported' && (isIOS() ? 'Cần iOS 16.4 trở lên và mở LDL từ Màn hình chính.' : 'Trình duyệt này chưa hỗ trợ thông báo đẩy — hãy dùng Microsoft Edge, Google Chrome hoặc Safari mới.')}
          </small>
        </div>
      </div>
      {state === 'ios-install' && <IosSteps />}
      {!mobile && !isStandalone() && (
        <div className="push-hint small">
          {installable
            ? <>Cài LDL thành ứng dụng trên Windows / macOS: mở trong cửa sổ riêng, ghim vào taskbar, có số thông báo trên biểu tượng.</>
            : <>Để cài LDL thành ứng dụng: trên <b>Edge</b> bấm ⋯ → <b>Ứng dụng</b> → <b>Cài đặt trang web này dưới dạng ứng dụng</b>; trên <b>Chrome</b> bấm biểu tượng <b>Cài đặt</b> <Download size={12} className="inline-ico" /> ở thanh địa chỉ.</>}
          {' '}Thông báo vẫn đến khi đã đóng cửa sổ LDL (trình duyệt chạy nền).
        </div>
      )}
      <div className="row gap-sm wrap">
        {installable && <button className="btn" onClick={install}><Download size={15} /> Cài ứng dụng LDL</button>}
        {state === 'off' && <button className="btn btn-primary" disabled={busy} onClick={on}><BellRing size={15} /> Bật thông báo</button>}
        {state === 'on' && <>
          <button className="btn" disabled={busy} onClick={test}><Send size={15} /> Gửi thử</button>
          <button className="btn btn-danger-ghost" disabled={busy} onClick={off}><BellOff size={15} /> Tắt trên thiết bị này</button>
        </>}
      </div>
    </section>
  );
}
