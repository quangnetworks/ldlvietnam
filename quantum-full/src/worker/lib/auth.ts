/**
 * Xác thực & phân quyền.
 * Thứ tự: (1) Bearer token (ADMIN_TOKEN / VIEWER_TOKEN) — dành cho tự động hoá;
 *         (2) Cloudflare Access JWT (header Cf-Access-Jwt-Assertion) — người dùng trình duyệt ở production;
 *         (3) Chế độ phát triển cục bộ (ALLOW_DEV_AUTH=true và APP_ENV khác production).
 * Không có thông tin xác thực hợp lệ ⇒ 401. Endpoint quản trị yêu cầu vai trò admin ⇒ 403.
 */
import type { MiddlewareHandler } from 'hono';
import { ApiError } from './http';
import { timingSafeEqual } from './hash';
import type { AppEnv, AuthUser, Role } from './types';

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

export type JwksFetcher = (teamDomain: string) => Promise<Jwk[]>;

const jwksCache = new Map<string, { keys: Jwk[]; expires: number }>();

export const defaultJwksFetcher: JwksFetcher = async (teamDomain) => {
  const cached = jwksCache.get(teamDomain);
  if (cached && cached.expires > Date.now()) return cached.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Không tải được JWKS của Access (${res.status})`);
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache.set(teamDomain, { keys: body.keys, expires: Date.now() + 10 * 60 * 1000 });
  return body.keys;
};

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

export interface AccessClaims {
  email?: string;
  sub?: string;
  aud: string | string[];
  iss: string;
  exp: number;
  nbf?: number;
}

/** Xác minh JWT RS256 của Cloudflare Access: chữ ký, aud, iss, exp/nbf. */
export async function verifyAccessJwt(token: string, teamDomain: string, aud: string, fetcher: JwksFetcher = defaultJwksFetcher, now = Date.now()): Promise<AccessClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('JWT sai định dạng');
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0]))) as { alg: string; kid: string };
  if (header.alg !== 'RS256') throw new Error('Thuật toán JWT không được hỗ trợ');
  const keys = await fetcher(teamDomain);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Không tìm thấy khoá ký JWT');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error('Chữ ký JWT không hợp lệ');
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))) as AccessClaims;
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud)) throw new Error('JWT sai audience');
  if (claims.iss !== `https://${teamDomain}`) throw new Error('JWT sai issuer');
  const t = Math.floor(now / 1000);
  if (typeof claims.exp !== 'number' || claims.exp < t) throw new Error('JWT đã hết hạn');
  if (claims.nbf && claims.nbf > t + 60) throw new Error('JWT chưa có hiệu lực');
  return claims;
}

function isAdminEmail(email: string, list: string | undefined): boolean {
  return (list ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export function authenticate(fetcher: JwksFetcher = defaultJwksFetcher): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const env = c.env;
    let user: AuthUser | null = null;
    const authz = c.req.header('authorization');
    if (authz) {
      const m = /^Bearer\s+(.+)$/i.exec(authz);
      const token = m?.[1]?.trim() ?? '';
      if (env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 16 && timingSafeEqual(token, env.ADMIN_TOKEN)) user = { id: 'token:admin', email: null, role: 'admin', method: 'token' };
      else if (env.VIEWER_TOKEN && env.VIEWER_TOKEN.length >= 16 && timingSafeEqual(token, env.VIEWER_TOKEN)) user = { id: 'token:viewer', email: null, role: 'viewer', method: 'token' };
      else throw new ApiError(401, 'unauthorized', 'Token không hợp lệ');
    }
    if (!user) {
      const jwt = c.req.header('cf-access-jwt-assertion');
      if (jwt && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
        try {
          const claims = await verifyAccessJwt(jwt, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD, fetcher);
          const email = claims.email ?? null;
          user = { id: email ?? claims.sub ?? 'access-user', email, role: email && isAdminEmail(email, env.ADMIN_EMAILS) ? 'admin' : 'viewer', method: 'access' };
        } catch (e) {
          throw new ApiError(401, 'unauthorized', `Cloudflare Access: ${(e as Error).message}`);
        }
      }
    }
    if (!user && env.ALLOW_DEV_AUTH === 'true' && env.APP_ENV !== 'production') {
      user = { id: 'dev@local', email: 'dev@local', role: 'admin', method: 'dev' };
    }
    if (!user) throw new ApiError(401, 'unauthorized', 'Yêu cầu đăng nhập (Cloudflare Access) hoặc API token');
    c.set('user', user);
    await next();
  };
}

export function requireRole(role: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) throw new ApiError(401, 'unauthorized', 'Chưa xác thực');
    if (role === 'admin' && user.role !== 'admin') throw new ApiError(403, 'forbidden', 'Chỉ quản trị viên được thực hiện thao tác này');
    await next();
  };
}

/** Mọi thao tác ghi (POST/PUT/PATCH/DELETE) yêu cầu quyền admin; viewer chỉ được đọc. */
export const writeRequiresAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.get('user').role !== 'admin') {
    throw new ApiError(403, 'forbidden', 'Tài khoản chỉ có quyền xem');
  }
  await next();
};
