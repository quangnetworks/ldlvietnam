/**
 * Web Push (thông báo đẩy) — chạy được cả trên Node lẫn Cloudflare Workers vì chỉ dùng WebCrypto.
 *  - VAPID (RFC 8292): cặp khoá ECDSA P-256 tự sinh lần đầu, lưu trong settings.vapid_keys
 *    (hoặc đặt biến môi trường VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY dạng JWK)
 *  - Mã hoá nội dung aes128gcm (RFC 8291 / RFC 8188)
 *  - iPhone / iPad: iOS 16.4+ nhận được khi ứng dụng đã "Thêm vào Màn hình chính"
 * Gửi đẩy chạy nền: trên Workers dùng ctx.waitUntil để không làm chậm phản hồi API.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { all, get, run, getSetting, setSetting, onNotify } from './db.js';

const enc = new TextEncoder();
export const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// ---------------------------------------------------------------- chạy nền theo từng request
const als = new AsyncLocalStorage();
/** Middleware: gắn ngữ cảnh thực thi (Workers: ctx.waitUntil) cho các tác vụ nền trong request. */
export function backgroundContext(c, next) {
  let ctx = null;
  try { ctx = c.executionCtx; } catch { /* Node: không có executionCtx */ }
  return als.run({ ctx }, next);
}
const pending = new Set();
/** Chạy promise ở nền — không chặn phản hồi, không làm hỏng request nếu lỗi. */
export function background(promise) {
  const p = Promise.resolve(promise).catch((e) => console.error('push:', e?.message || e));
  const store = als.getStore();
  if (store?.ctx?.waitUntil) store.ctx.waitUntil(p);
  pending.add(p);
  p.finally(() => pending.delete(p));
  return p;
}
/** Chờ các tác vụ nền xong (dùng trong kiểm thử). */
export const flushBackground = () => Promise.allSettled([...pending]);

// ---------------------------------------------------------------- khoá VAPID
let cachedKeys = null;
async function vapidKeys(env) {
  if (cachedKeys) return cachedKeys;
  let pub; let priv;
  if (env?.VAPID_PUBLIC_KEY && env?.VAPID_PRIVATE_KEY) {
    pub = env.VAPID_PUBLIC_KEY;
    priv = JSON.parse(env.VAPID_PRIVATE_KEY);
  } else {
    const saved = await getSetting('vapid_keys');
    if (saved) ({ pub, priv } = JSON.parse(saved));
    else {
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      pub = b64url(await crypto.subtle.exportKey('raw', kp.publicKey));
      priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
      await setSetting('vapid_keys', JSON.stringify({ pub, priv }));
    }
  }
  const signKey = await crypto.subtle.importKey('jwk', { ...priv, key_ops: ['sign'], ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  cachedKeys = { pub, signKey };
  return cachedKeys;
}
export const vapidPublicKey = async (env) => (await vapidKeys(env)).pub;

async function vapidAuth(endpoint, env) {
  const { pub, signKey } = await vapidKeys(env);
  const aud = new URL(endpoint).origin;
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env?.VAPID_SUBJECT || 'mailto:admin@ldlvietnam.vn',
  })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signKey, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${pub}`;
}

// ---------------------------------------------------------------- mã hoá aes128gcm (RFC 8291)
async function hkdf(salt, ikm, info, bits) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits));
}

/** Mã hoá payload cho một subscription (p256dh, auth dạng base64url). Trả về thân yêu cầu hoàn chỉnh. */
export async function encryptPayload(payload, p256dh, auth) {
  const uaPublic = unb64url(p256dh);
  const authSecret = unb64url(auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 96);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(enc.encode(typeof payload === 'string' ? payload : JSON.stringify(payload)), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** Gửi một thông báo đẩy. Trả về mã HTTP của dịch vụ đẩy (Apple / Google / Mozilla…). */
export async function sendPush(sub, payload, env) {
  const body = await encryptPayload(payload, sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(sub.endpoint, env),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
    },
    body,
  });
  return res.status;
}

// ---------------------------------------------------------------- gửi tới người dùng
const APP_LABEL = {
  office: 'LDL Office', wework: 'LDL Wework', request: 'LDL Request', message: 'LDL Message', drive: 'LDL Drive',
  hrm: 'LDL HRM', checkin: 'LDL Checkin', timeoff: 'LDL Timeoff',
};
let pushEnv = null;
/** Biến môi trường (VAPID_*) của Worker — gọi một lần khi khởi động. */
export const setPushEnv = (env) => { pushEnv = env; };

/**
 * Đẩy thông báo tới mọi thiết bị đã đăng ký của các tài khoản (chạy nền).
 * { app, title, body, link, tag } — title mặc định là tên ứng dụng.
 */
export function pushToUsers(userIds, { app, title, body, link, tag }) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return null;
  return background((async () => {
    const subs = await all(`SELECT s.*, (SELECT COUNT(*) FROM notifications n WHERE n.user_id = s.user_id AND n.is_read = 0) AS unread
      FROM push_subscriptions s JOIN users u ON u.id = s.user_id AND u.active = 1
      WHERE s.user_id IN (${ids.map(() => '?').join(',')})`, ...ids);
    await Promise.all(subs.map(async (s) => {
      try {
        const status = await sendPush(s, {
          title: title || APP_LABEL[app] || 'LDL Việt Nam', body: body || '', url: link || '/', tag: tag || undefined, badge: s.unread,
        }, pushEnv);
        if (status === 404 || status === 410) await run('DELETE FROM push_subscriptions WHERE id = ?', s.id); // thiết bị đã huỷ đăng ký
        else if (status < 300) await run("UPDATE push_subscriptions SET last_push_at = datetime('now'), fail_count = 0 WHERE id = ?", s.id);
        else await run('UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = ?', s.id);
      } catch (e) {
        await run('UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = ?', s.id);
        console.error('push send:', e?.message || e);
      }
    }));
    await run('DELETE FROM push_subscriptions WHERE fail_count >= 20');
  })());
}

export async function saveSubscription(user, sub, userAgent) {
  const endpoint = String(sub?.endpoint || '');
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return false;
  if (unb64url(p256dh).length !== 65 || unb64url(auth).length < 16) return false;
  await run(`INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth, user_agent) VALUES (?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
      user_agent = excluded.user_agent, fail_count = 0`, user.id, endpoint, p256dh, auth, String(userAgent || '').slice(0, 300));
  return true;
}

export const listSubscriptions = (user) => all('SELECT id, user_agent, created_at, last_push_at FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC', user.id);
export const removeSubscription = (user, endpoint) => run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', user.id, endpoint);
export const hasSubscription = async (user, endpoint) => !!(await get('SELECT 1 FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', user.id, endpoint));

// Mọi thông báo trong hệ thống (giao việc, duyệt đề xuất, văn bản, nhắc tên, tin nhắn 1-1…) → đẩy tới điện thoại
onNotify((ids, n) => {
  pushToUsers(ids, { app: n.app, body: n.title, link: n.link, tag: n.app === 'message' && n.link ? `chat:${n.link}` : undefined });
});
