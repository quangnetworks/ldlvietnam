/**
 * Single sign-on into NPP Control Tower (npp.vanquang.xyz) with the Workspace account.
 *
 * Flow (all redirects are top-level browser navigations):
 *   1. NPP /api/auth/workspace/start  → sets a one-time `state` cookie on NPP, sends the browser to /sso/npp?state=…
 *   2. /sso/npp (client page, behind the normal Workspace login incl. 2FA / IP rules) → POST /api/sso/npp { state }
 *   3. This route checks the account may use the "npp" app (requireModule, see platform.js PREFIXES), then returns
 *      NPP's callback URL with a ticket: HS256, 60 s, single use (jti), audience "npp-control-tower", carrying
 *      only the Workspace user id and the state. NPP reads name, title and territories itself (read-only).
 * Opened from the Workspace app tile (no state yet) → step 1 first, so every login is bound to NPP's state cookie.
 */
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { badRequest, HttpError, jsonBody } from '../util.js';
import { audit } from '../platform.js';

const r = new Hono();

export const NPP_AUDIENCE = 'npp-control-tower';
export const NPP_ISSUER = 'ldl-workspace';
const TICKET_TTL = 60;

const env = (c, k) => c.env?.[k] || (typeof process !== 'undefined' ? process.env?.[k] : undefined);
const nppUrl = (c) => String(env(c, 'NPP_URL') || 'https://npp.vanquang.xyz').replace(/\/+$/, '');
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

r.post('/sso/npp', async (c) => {
  const secret = env(c, 'NPP_SSO_SECRET');
  if (!secret) throw new HttpError(503, 'Chưa cấu hình đăng nhập NPP Control Tower (NPP_SSO_SECRET).');
  const b = await jsonBody(c);
  const state = typeof b.state === 'string' ? b.state.trim() : '';
  // Started from the app tile: let NPP create its state first.
  if (!state) return c.json({ url: `${nppUrl(c)}/api/auth/workspace/start` });
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) throw badRequest('Yêu cầu đăng nhập không hợp lệ');
  const user = c.get('user');
  const now = Math.floor(Date.now() / 1000);
  const ticket = await sign(
    { sub: String(user.id), aud: NPP_AUDIENCE, iss: NPP_ISSUER, state, iat: now, exp: now + TICKET_TTL, jti: b64url(crypto.getRandomValues(new Uint8Array(16))) },
    secret,
    'HS256'
  );
  await audit(user.id, 'sso', 'Đăng nhập NPP Control Tower');
  return c.json({ url: `${nppUrl(c)}/api/auth/workspace/callback?ticket=${encodeURIComponent(ticket)}&state=${encodeURIComponent(state)}` });
});

export default r;
