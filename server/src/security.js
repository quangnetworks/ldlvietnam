/** Security helpers: TOTP two-factor codes (RFC 6238) and IP allow-list matching. */
import { getSetting } from './db.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function randomBase32(bytes = 20) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s) {
  const clean = s.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = '';
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error('invalid base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

export async function totpCode(secret, counter) {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256); }
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/** Accept the current 30-second window and one window either side (clock drift). */
export async function verifyTotp(secret, code, now = Date.now()) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean) || !secret) return false;
  const counter = Math.floor(now / 30000);
  for (const d of [0, -1, 1]) if ((await totpCode(secret, counter + d)) === clean) return true;
  return false;
}

export const otpauthUrl = (secret, account, issuer = 'LDL Viet Nam') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;

// ---------------------------------------------------------------- IP allow-list
function ipv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

/** Rule: "203.0.113.5", "203.0.113.0/24" or an exact IPv6 address. */
export function ipMatches(ip, rule) {
  if (!ip || !rule) return false;
  const r = rule.trim();
  if (!r.includes('/')) return ip.trim().toLowerCase() === r.toLowerCase();
  const [base, bitsStr] = r.split('/');
  const bits = Number(bitsStr);
  const a = ipv4ToInt(ip.trim());
  const b = ipv4ToInt(base);
  if (a === null || b === null || !(bits >= 0 && bits <= 32)) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

export const validIpRule = (rule) => {
  const r = rule.trim();
  if (r.includes(':')) return /^[0-9a-f:]+$/i.test(r);
  const [base, bits] = r.split('/');
  return ipv4ToInt(base) !== null && (bits === undefined || (/^\d+$/.test(bits) && Number(bits) <= 32));
};

export function clientIp(c) {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || null;
}

export async function securitySettings() {
  try {
    return { ip_enabled: false, ip_rules: [], require_2fa_admin: false, ...JSON.parse((await getSetting('security_settings')) || '{}') };
  } catch {
    return { ip_enabled: false, ip_rules: [], require_2fa_admin: false };
  }
}

/** Admins are never blocked by the IP list, so a mistake cannot lock everyone out. */
export async function ipAllowed(c, user) {
  if (user.role === 'admin') return true;
  const st = await securitySettings();
  if (!st.ip_enabled || !st.ip_rules.length) return true;
  const ip = clientIp(c);
  return st.ip_rules.some((r) => ipMatches(ip, r));
}
