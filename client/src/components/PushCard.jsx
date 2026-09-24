/**
 * Bật / tắt thông báo đẩy trên thiết bị này, kèm hướng dẫn "Thêm vào Màn hình chính" cho iPhone.
 * compact: dải nhắc nhỏ ở Trang chủ (có thể ẩn), chỉ hiện khi cần hành động.
 */
import { useEffect, useState } from 'react';
import { BellRing, BellOff, Share, PlusSquare, Smartphone, Send, X, CheckCircle2 } from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { pushState, enablePush, disablePush, isIOS } from '../push.js';
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

export default function PushCard({ compact = false }) {
  const toast = useToast();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } });
  useEffect(() => { pushState().then(setState); }, []);

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

  if (!state) return null;

  if (compact) {
    const phone = window.matchMedia('(max-width: 800px)').matches;
    if (hidden || !['off', 'ios-install'].includes(state) || (state === 'ios-install' && !phone)) return null;
    const hide = () => { try { localStorage.setItem(HIDE_KEY, '1'); } catch { /* bỏ qua */ } setHidden(true); };
    return (
      <div className="push-banner">
        <span className="push-banner-ico"><BellRing size={18} /></span>
        <div className="grow">
          <b>{state === 'off' ? 'Nhận thông báo trên điện thoại' : 'Cài LDL lên iPhone để nhận thông báo'}</b>
          <small className="block">{state === 'off' ? 'Việc được giao, đề xuất cần duyệt, tin nhắn… hiện ngay cả khi không mở ứng dụng.'
            : <>Bấm <Share size={12} className="inline-ico" /> Chia sẻ → <b>Thêm vào MH chính</b>, rồi mở LDL từ Màn hình chính.</>}</small>
        </div>
        {state === 'off' && <button className="btn btn-sm btn-primary" disabled={busy} onClick={on}>Bật</button>}
        <button className="icon-btn sm" onClick={hide} aria-label="Ẩn"><X size={15} /></button>
      </div>
    );
  }

  return (
    <section className={cx('push-card', state === 'on' && 'on')}>
      <div className="push-card-head">
        <span className="push-banner-ico">{state === 'on' ? <BellRing size={20} /> : state === 'denied' ? <BellOff size={20} /> : <Smartphone size={20} />}</span>
        <div className="grow">
          <b>Thông báo đẩy trên thiết bị này</b>
          <small className="muted block">
            {state === 'on' && <><CheckCircle2 size={12} className="inline-ico text-green" /> Đang nhận: việc được giao, bình luận, đề xuất cần duyệt, văn bản, tin nhắn 1-1 và nhóm, nhắc tên.</>}
            {state === 'off' && 'Nhận thông báo ngay cả khi không mở ứng dụng; số chưa đọc hiện trên biểu tượng LDL.'}
            {state === 'denied' && (isIOS() ? 'Thông báo đang bị chặn. Mở Cài đặt → Thông báo → LDL → bật Cho phép thông báo.' : 'Thông báo đang bị chặn cho trang này. Cho phép lại trong cài đặt trang của trình duyệt.')}
            {state === 'ios-install' && 'Trên iPhone, thông báo đẩy chỉ hoạt động khi LDL được thêm vào Màn hình chính:'}
            {state === 'unsupported' && (isIOS() ? 'Cần iOS 16.4 trở lên và mở LDL từ Màn hình chính.' : 'Trình duyệt này chưa hỗ trợ thông báo đẩy.')}
          </small>
        </div>
      </div>
      {state === 'ios-install' && <IosSteps />}
      <div className="row gap-sm wrap">
        {state === 'off' && <button className="btn btn-primary" disabled={busy} onClick={on}><BellRing size={15} /> Bật thông báo</button>}
        {state === 'on' && <>
          <button className="btn" disabled={busy} onClick={test}><Send size={15} /> Gửi thử</button>
          <button className="btn btn-danger-ghost" disabled={busy} onClick={off}><BellOff size={15} /> Tắt trên thiết bị này</button>
        </>}
      </div>
    </section>
  );
}
