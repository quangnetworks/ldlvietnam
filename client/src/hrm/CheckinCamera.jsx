import { useEffect, useRef, useState } from 'react';
import { Camera, MapPin, RotateCcw, X } from 'lucide-react';

/** Thiết bị di động (kể cả iPad đời mới báo UA là Macintosh). */
export function isMobileDevice() {
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Thiết bị không hỗ trợ định vị')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'Bạn cần cho phép truy cập vị trí để chấm công' : 'Không lấy được vị trí, hãy thử lại ở nơi thoáng hơn')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

const stampTime = (d) => d.toLocaleString('vi-VN', { hour12: false, timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

/** Vẽ ảnh (video frame / ảnh chọn) lên canvas tối đa 1280px, in dấu thời gian + vị trí + tên ở góc dưới. */
function renderStamped(source, sw, sh, lines) {
  const scale = Math.min(1, 1280 / Math.max(sw, sh));
  const w = Math.round(sw * scale); const h = Math.round(sh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, w, h);
  const fs = Math.max(14, Math.round(w / 34));
  const pad = Math.round(fs * 0.6);
  const boxH = lines.length * fs * 1.35 + pad * 2;
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(0, h - boxH, w, boxH);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  lines.forEach((t, i) => {
    ctx.font = `${i === 0 ? 'bold ' : ''}${fs}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText(t, pad, h - boxH + pad + i * fs * 1.35, w - pad * 2);
  });
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82));
}

/**
 * Hộp thoại chụp ảnh chấm công: camera trước + GPS; ảnh được in sẵn thời gian, toạ độ, tên nhân viên.
 * onConfirm({ file, lat, lng, accuracy }) — trả Promise; hộp thoại đóng khi thành công.
 */
export function CheckinCamera({ kind, userName, office, onConfirm, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);
  const [geo, setGeo] = useState(null);
  const [geoErr, setGeoErr] = useState('');
  const [camErr, setCamErr] = useState('');
  const [shot, setShot] = useState(null); // { blob, url }
  const [busy, setBusy] = useState(false);

  // <video> được gắn lại mỗi lần "Chụp lại" nên nối stream qua ref callback.
  const attach = (el) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) { el.srcObject = streamRef.current; el.play().catch(() => {}); }
  };
  const locate = () => { setGeoErr(''); getPosition().then(setGeo).catch((e) => setGeoErr(e.message)); };

  useEffect(() => {
    locate();
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false });
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s;
        attach(videoRef.current);
      } catch {
        setCamErr('Không mở được camera trực tiếp — bấm "Chụp ảnh" để dùng camera của điện thoại.');
      }
    })();
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  const lines = () => [
    `${kind === 'in' ? 'CHẤM CÔNG VÀO' : 'CHẤM CÔNG RA'} · ${stampTime(new Date())}`,
    `${userName}${office ? ` · ${office}` : ''}`,
    `GPS ${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)} (±${Math.round(geo.accuracy)} m)`,
  ];

  const capture = async () => {
    const v = videoRef.current;
    if (!streamRef.current || !v?.videoWidth) { fileRef.current?.click(); return; }
    const blob = await renderStamped(v, v.videoWidth, v.videoHeight, lines());
    setShot({ blob, url: URL.createObjectURL(blob) });
  };
  const fromFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const img = new Image();
    img.src = URL.createObjectURL(f);
    await img.decode().catch(() => {});
    const blob = await renderStamped(img, img.naturalWidth, img.naturalHeight, lines());
    URL.revokeObjectURL(img.src);
    setShot({ blob, url: URL.createObjectURL(blob) });
  };
  const confirm = async () => {
    if (!shot || !geo) return;
    setBusy(true);
    try {
      const file = new File([shot.blob], `checkin-${kind}.jpg`, { type: 'image/jpeg' });
      await onConfirm({ file, ...geo });
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop ci-cam-backdrop" role="dialog" aria-modal="true" aria-label="Chụp ảnh chấm công">
      <div className="ci-cam">
        <div className="row between">
          <b>{kind === 'in' ? 'Chấm công vào' : 'Chấm công ra'} · chụp ảnh</b>
          <button className="icon-btn" onClick={onClose} aria-label="Đóng"><X size={18} /></button>
        </div>
        <div className="ci-cam-view">
          {shot ? <img src={shot.url} alt="Ảnh chấm công" /> : <video ref={attach} playsInline muted autoPlay />}
        </div>
        <div className={geo ? 'ci-cam-geo ok' : 'ci-cam-geo'}>
          <MapPin size={14} />
          {geo ? <span>{geo.lat.toFixed(6)}, {geo.lng.toFixed(6)} · ±{Math.round(geo.accuracy)} m</span>
            : geoErr ? <span>{geoErr} <button className="link" onClick={locate}>Thử lại</button></span>
              : <span>Đang xác định vị trí…</span>}
        </div>
        {camErr && !shot && <small className="muted">{camErr}</small>}
        <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={fromFile} />
        <div className="row gap ci-cam-actions">
          {shot ? (
            <>
              <button className="btn" onClick={() => setShot(null)} disabled={busy}><RotateCcw size={15} /> Chụp lại</button>
              <button className="btn btn-primary" onClick={confirm} disabled={busy || !geo}>{busy ? 'Đang gửi…' : 'Xác nhận chấm công'}</button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={capture} disabled={!geo}><Camera size={16} /> {geo ? 'Chụp ảnh' : 'Chờ định vị…'}</button>
          )}
        </div>
      </div>
    </div>
  );
}

export const mapUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;
