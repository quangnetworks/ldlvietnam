import { hashPassword, readCookie, signSession, verifyPassword, verifySession } from './auth';
import { WeddingStore, type GuestInput } from './store';

export { WeddingStore };

interface Env {
  ASSETS: Fetcher;
  STORE: DurableObjectNamespace<WeddingStore>;
  /** Băm mật khẩu quản trị ban đầu (đổi được trong Studio → Cài đặt). */
  ADMIN_PASSWORD_HASH: string;
}

const COOKIE = 'hm_session';
const SESSION_TTL = 60 * 60 * 24 * 14; // 14 ngày

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
const fail = (message: string, status = 400) => json({ error: message }, status);

function store(env: Env) {
  return env.STORE.get(env.STORE.idFromName('main'));
}

async function sessionSecret(s: DurableObjectStub<WeddingStore>) {
  let secret = await s.getValue('session_secret');
  if (!secret) {
    secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    await s.setValue('session_secret', secret);
  }
  const ver = (await s.getValue('session_ver')) ?? '1';
  return { secret, ver };
}

async function isAdmin(req: Request, s: DurableObjectStub<WeddingStore>) {
  const { secret, ver } = await sessionSecret(s);
  return verifySession(secret, readCookie(req, COOKIE), ver);
}

/**
 * Mật khẩu hiện hành: bản đã đổi trong Studio, trừ khi mật khẩu mặc định trong cấu hình
 * vừa được thay — khi đó mật khẩu mặc định mới có hiệu lực trở lại.
 */
async function currentPasswordHash(env: Env, s: DurableObjectStub<WeddingStore>) {
  if ((await s.getValue('env_password_hash')) !== env.ADMIN_PASSWORD_HASH) {
    await s.setValue('env_password_hash', env.ADMIN_PASSWORD_HASH);
    await s.setValue('password_hash', '');
  }
  return (await s.getValue('password_hash')) || env.ADMIN_PASSWORD_HASH;
}

function sessionCookie(value: string, maxAge: number) {
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

/** Chặn gửi yêu cầu thay đổi dữ liệu từ trang khác (CSRF). */
function sameOrigin(req: Request) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.get('Origin');
  return !origin || origin === new URL(req.url).origin;
}

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error('Dữ liệu gửi lên không hợp lệ');
  }
}

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const s = store(env);
  const path = url.pathname.replace(/^\/api/, '');
  const m = req.method;

  if (!sameOrigin(req)) return fail('Nguồn yêu cầu không hợp lệ', 403);

  // ——— công khai ———
  if (m === 'GET' && path.startsWith('/invite/')) {
    const token = path.slice('/invite/'.length);
    if (!/^[A-Za-z0-9]{6,32}$/.test(token)) return fail('Không tìm thấy thiệp', 404);
    // Không tính lượt mở khi chính chủ tiệc đang đăng nhập xem thử.
    const track = url.searchParams.get('preview') !== '1' && !(await isAdmin(req, s));
    const inv = await s.openInvite(token, track);
    if (!inv) return fail('Không tìm thấy thiệp', 404);
    return json({ display_name: inv.display_name, design: inv.design ? JSON.parse(inv.design) : null });
  }

  if (m === 'POST' && path === '/auth/login') {
    const gate = await s.loginAllowed();
    if (!gate.ok) return fail(`Nhập sai quá nhiều lần. Thử lại sau ${Math.ceil(gate.retryAfter / 60)} phút.`, 429);
    const { password } = await body<{ password?: string }>(req);
    const stored = await currentPasswordHash(env, s);
    const ok = !!password && !!stored && (await verifyPassword(password, stored));
    await s.recordLogin(ok);
    if (!ok) return fail('Mật khẩu không đúng', 401);
    const { secret, ver } = await sessionSecret(s);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(await signSession(secret, SESSION_TTL, ver), SESSION_TTL) });
  }

  if (m === 'POST' && path === '/auth/logout') return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });

  if (m === 'GET' && path === '/auth/me') return json({ admin: await isAdmin(req, s) });

  // ——— từ đây trở đi cần đăng nhập ———
  if (!(await isAdmin(req, s))) return fail('Cần đăng nhập', 401);

  if (m === 'POST' && path === '/auth/password') {
    const { current, next } = await body<{ current?: string; next?: string }>(req);
    const stored = await currentPasswordHash(env, s);
    if (!current || !(await verifyPassword(current, stored))) return fail('Mật khẩu hiện tại không đúng', 400);
    if (!next || next.length < 10) return fail('Mật khẩu mới cần ít nhất 10 ký tự');
    await s.setValue('password_hash', await hashPassword(next));
    // Đổi phiên bản phiên → đăng xuất mọi thiết bị khác.
    const ver = String(Number((await s.getValue('session_ver')) ?? '1') + 1);
    await s.setValue('session_ver', ver);
    const { secret } = await sessionSecret(s);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(await signSession(secret, SESSION_TTL, ver), SESSION_TTL) });
  }

  if (m === 'GET' && path === '/state') {
    const design = await s.getValue('design');
    return json({ guests: await s.listGuests(), design: design ? JSON.parse(design) : null });
  }

  if (m === 'PUT' && path === '/design') {
    const design = await body<unknown>(req);
    const raw = JSON.stringify(design);
    if (raw.length > 20_000) return fail('Thiết kế quá lớn');
    await s.setValue('design', raw);
    return json({ ok: true, saved_at: new Date().toISOString() });
  }

  if (m === 'POST' && path === '/guests') return json(await s.createGuest(await body<GuestInput>(req)), 201);

  if (m === 'POST' && path === '/guests/import') {
    const { rows, mode } = await body<{ rows: GuestInput[]; mode: 'skip' | 'overwrite' }>(req);
    if (!Array.isArray(rows) || rows.length > 3000) return fail('Tối đa 3.000 dòng mỗi lần nhập');
    return json(await s.importGuests(rows, mode === 'overwrite' ? 'overwrite' : 'skip'));
  }

  if (m === 'POST' && path === '/guests/status') {
    const { ids, status } = await body<{ ids: string[]; status: 'draft' | 'ready' | 'exported' | 'error' }>(req);
    return json(await s.setStatus(ids ?? [], status));
  }

  if (m === 'POST' && path === '/guests/sent') {
    const { ids } = await body<{ ids: string[] }>(req);
    return json(await s.markSent(ids ?? []));
  }

  if (m === 'POST' && path === '/guests/delete') {
    const { ids } = await body<{ ids: string[] }>(req);
    return json(await s.deleteGuests(ids ?? []));
  }

  const one = path.match(/^\/guests\/([^/]+)(\/rotate)?$/);
  if (one) {
    const id = decodeURIComponent(one[1]);
    if (m === 'PUT' && !one[2]) return json(await s.updateGuest(id, await body<GuestInput>(req)));
    if (m === 'POST' && one[2]) return json(await s.rotateToken(id));
  }

  if (m === 'GET' && path === '/backup') {
    const b = await s.backup();
    return json(b, 200, { 'Content-Disposition': `attachment; filename="hm-wedding-backup-${b.exported_at.slice(0, 10)}.json"` });
  }

  return fail('Không tìm thấy', 404);
}

/** /t/<token>: trả về SPA kèm thẻ xem trước (Zalo, Messenger) mang tên khách. */
async function invitePage(req: Request, env: Env, token: string) {
  const page = await env.ASSETS.fetch(new Request(new URL('/', req.url), { headers: req.headers }));
  const inv = /^[A-Za-z0-9]{6,32}$/.test(token) ? await store(env).peekInvite(token) : null;
  const origin = new URL(req.url).origin;
  const title = inv ? `Thiệp mời — ${inv.display_name}` : 'Thiệp cưới H&M';
  const desc = 'Trần Minh Huy & Tiểu Bảo Muội trân trọng kính mời — Tiệc cưới 18:00 Thứ Bảy 14.11.2026, Adora Luxury.';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:image" content="${origin}/og-cover.jpg">`,
    `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`,
    `<meta property="og:url" content="${esc(req.url)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="robots" content="noindex, nofollow">`,
  ].join('');
  const res = new HTMLRewriter()
    .on('title', { element: (el) => void el.setInnerContent(title) })
    .on('head', { element: (el) => void el.append(tags, { html: true }) })
    .transform(page);
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'no-store');
  out.headers.set('Content-Type', 'text/html; charset=utf-8');
  return out;
}

function secure(res: Response) {
  const r = new Response(res.body, res);
  r.headers.set('X-Content-Type-Options', 'nosniff');
  r.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  r.headers.set('X-Frame-Options', 'SAMEORIGIN');
  return r;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/')) return secure(await api(req, env, url));
      const t = url.pathname.match(/^\/t\/([^/]+)\/?$/);
      if (t) return secure(await invitePage(req, env, t[1]));
      return env.ASSETS.fetch(req);
    } catch (e) {
      return secure(fail((e as Error).message || 'Lỗi máy chủ', 400));
    }
  },
} satisfies ExportedHandler<Env>;
