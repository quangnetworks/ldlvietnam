/**
 * Thông báo đẩy (Web Push) phía trình duyệt.
 * iPhone / iPad: chỉ hoạt động khi mở từ biểu tượng ở Màn hình chính (iOS 16.4+) và người dùng bấm "Bật".
 */
import { api } from './api.js';

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const toKey = (b64) => {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
};

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg || navigator.serviceWorker.register('/sw.js');
}

/**
 * Trạng thái trên thiết bị này:
 *  'unsupported' — trình duyệt không hỗ trợ · 'ios-install' — iPhone chưa thêm vào Màn hình chính
 *  'denied' — đã chặn trong Cài đặt · 'off' — chưa bật · 'on' — đang nhận thông báo
 */
export async function pushState() {
  if (!pushSupported()) return isIOS() && !isStandalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (!sub || Notification.permission !== 'granted') return 'off';
    const r = await api.post('/push/status', { endpoint: sub.endpoint });
    if (!r.subscribed) await api.post('/push/subscribe', sub.toJSON()); // đăng ký thuộc tài khoản khác / đã bị xoá → gắn lại
    return 'on';
  } catch {
    return 'off';
  }
}

/** Bật thông báo đẩy — PHẢI gọi trong sự kiện bấm nút (yêu cầu của iOS). */
export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Bạn đã chặn thông báo. Mở Cài đặt → Thông báo → LDL để cho phép.' : 'Chưa cấp quyền thông báo');
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const { key } = await api.get('/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // khoá VAPID của máy chủ đã đổi → đăng ký lại
    const cur = sub.options?.applicationServerKey;
    if (cur && btoa(String.fromCharCode(...new Uint8Array(cur))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== key) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key) });
  await api.post('/push/subscribe', sub.toJSON());
}

/** Tắt trên thiết bị này (cũng gọi khi đăng xuất để máy dùng chung không nhận thông báo của người khác). */
export async function disablePush() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* bỏ qua */ }
}

/** Số trên biểu tượng ứng dụng (Màn hình chính iOS / Android / Dock). */
export function setBadge(n) {
  try {
    if (n > 0) navigator.setAppBadge?.(n)?.catch?.(() => {});
    else navigator.clearAppBadge?.()?.catch?.(() => {});
  } catch { /* bỏ qua */ }
}
