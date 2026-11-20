import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { verifyAccessJwt, authenticate } from '../../src/worker/lib/auth';
import { createApp } from '../../src/worker/index';
import { ADMIN, VIEWER, api } from './helpers';

describe('Database migrations', () => {
  it('Đủ 18 bảng nghiệp vụ', async () => {
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'").all<{ name: string }>();
    const names = results.map((r) => r.name).sort();
    for (const t of ['games', 'data_sources', 'draws', 'draw_numbers', 'model_versions', 'model_runs', 'recommendations', 'recommendation_numbers', 'portfolios', 'tickets', 'ticket_numbers', 'backtest_runs', 'backtest_metrics', 'ticket_results', 'bankroll_ledger', 'audit_logs', 'app_settings', 'import_jobs'])
      expect(names).toContain(t);
  });
  it('Seed cấu hình 2 game, không có dữ liệu lịch sử giả', async () => {
    const games = await env.DB.prepare('SELECT code, rules_verification_status FROM games ORDER BY id').all<{ code: string; rules_verification_status: string }>();
    expect(games.results.map((g) => g.code)).toEqual(['lotto535', 'power655']);
    expect(games.results.every((g) => g.rules_verification_status === 'unverified')).toBe(true);
    const draws = await env.DB.prepare('SELECT COUNT(*) AS n FROM draws').first<{ n: number }>();
    expect(draws!.n).toBe(0);
  });
  it('Ràng buộc khoá ngoại & CHECK hoạt động', async () => {
    await expect(env.DB.prepare("INSERT INTO draws (game_id, draw_code, draw_date, draw_at, data_source_id, source_hash) VALUES (999, 'x', '2025-01-01', '2025-01-01T00:00:00Z', 1, 'h')").run()).rejects.toThrow();
    await expect(env.DB.prepare("INSERT INTO bankroll_ledger (entry_type, mode, amount, entry_date, created_by) VALUES ('purchase', 'real', 1000, '2025-01-01', 't')").run()).rejects.toThrow();
  });
  it('Audit log & sổ quỹ là bất biến', async () => {
    await env.DB.prepare("INSERT INTO audit_logs (actor, actor_role, action, entity_type) VALUES ('t', 'admin', 'x', 'y')").run();
    await expect(env.DB.prepare("UPDATE audit_logs SET action = 'z'").run()).rejects.toThrow(/audit_immutable/);
    await expect(env.DB.prepare('DELETE FROM audit_logs').run()).rejects.toThrow(/audit_immutable/);
  });
  it('Kết quả đã xác minh không thể bị ghi đè trực tiếp', async () => {
    await env.DB.prepare("INSERT INTO draws (game_id, draw_code, draw_date, draw_at, data_source_id, source_hash, verification_status) VALUES (1, 'V1', '2025-01-01', '2025-01-01T06:00:00Z', 1, 'h', 'verified')").run();
    await expect(env.DB.prepare("UPDATE draws SET special_number = 3 WHERE draw_code = 'V1'").run()).rejects.toThrow(/verified_draw_immutable/);
    await expect(env.DB.prepare("INSERT INTO draw_numbers (draw_id, position, number) VALUES ((SELECT id FROM draws WHERE draw_code = 'V1'), 1, 5)").run()).rejects.toThrow(/verified_draw_immutable/);
    await expect(env.DB.prepare("DELETE FROM draws WHERE draw_code = 'V1'").run()).rejects.toThrow(/verified_draw_immutable/);
  });
});

describe('Authentication & Authorization', () => {
  it('/health công khai', async () => {
    const r = await api('/health', { token: null });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
  });
  it('Không có thông tin xác thực ⇒ 401', async () => {
    expect((await api('/games', { token: null })).status).toBe(401);
    expect((await api('/admin/draws/import', { token: null, body: {} })).status).toBe(401);
  });
  it('Token sai ⇒ 401', async () => {
    expect((await api('/games', { token: 'wrong-token-wrong-token' })).status).toBe(401);
  });
  it('Viewer được đọc, không được ghi; admin endpoint ⇒ 403', async () => {
    expect((await api('/games', { token: VIEWER })).status).toBe(200);
    expect((await api('/me', { token: VIEWER })).body.data.role).toBe('viewer');
    expect((await api('/admin/draws/import', { token: VIEWER, body: { game: 'lotto535' } })).status).toBe(403);
    expect((await api('/generator/generate', { token: VIEWER, body: {} })).status).toBe(403);
    expect((await api('/audit', { token: VIEWER })).status).toBe(403);
    expect((await api('/admin/settings', { token: VIEWER, method: 'PUT', body: {} })).status).toBe(403);
  });
  it('Admin token hoạt động', async () => {
    const r = await api('/me', { token: ADMIN });
    expect(r.body.data).toMatchObject({ role: 'admin', method: 'token' });
  });
  it('Header Cf-Access-Jwt-Assertion giả mạo bị từ chối khi Access chưa cấu hình', async () => {
    expect((await api('/games', { token: null, headers: { 'cf-access-jwt-assertion': 'a.b.c' } })).status).toBe(401);
  });
  it('Endpoint không tồn tại ⇒ 404 JSON', async () => {
    const r = await api('/nope');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('not_found');
  });
});

describe('Cloudflare Access JWT', () => {
  async function makeToken(claims: Record<string, unknown>) {
    const kp = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey;
    const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const head = enc({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
    const body = enc(claims);
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${head}.${body}`)));
    const s = btoa(String.fromCharCode(...sig)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    return { token: `${head}.${body}.${s}`, fetcher: async () => [{ kid: 'k1', kty: 'RSA', n: jwk.n!, e: jwk.e! }] };
  }
  const base = { aud: 'aud-1', iss: 'https://team.cloudflareaccess.com', exp: Math.floor(Date.now() / 1000) + 600, email: 'owner@example.com' };

  it('Chữ ký hợp lệ được chấp nhận', async () => {
    const { token, fetcher } = await makeToken(base);
    const claims = await verifyAccessJwt(token, 'team.cloudflareaccess.com', 'aud-1', fetcher);
    expect(claims.email).toBe('owner@example.com');
  });
  it('Sai audience / hết hạn / sai issuer bị từ chối', async () => {
    const a = await makeToken({ ...base, aud: 'other' });
    await expect(verifyAccessJwt(a.token, 'team.cloudflareaccess.com', 'aud-1', a.fetcher)).rejects.toThrow(/audience/);
    const b = await makeToken({ ...base, exp: 1 });
    await expect(verifyAccessJwt(b.token, 'team.cloudflareaccess.com', 'aud-1', b.fetcher)).rejects.toThrow(/hết hạn/);
    const d = await makeToken({ ...base, iss: 'https://evil.example' });
    await expect(verifyAccessJwt(d.token, 'team.cloudflareaccess.com', 'aud-1', d.fetcher)).rejects.toThrow(/issuer/);
  });
  it('Chữ ký bị sửa bị từ chối', async () => {
    const { token, fetcher } = await makeToken(base);
    const parts = token.split('.');
    const forged = `${parts[0]}.${btoa(JSON.stringify({ ...base, email: 'attacker@example.com' })).replace(/=+$/, '')}.${parts[2]}`;
    await expect(verifyAccessJwt(forged, 'team.cloudflareaccess.com', 'aud-1', fetcher)).rejects.toThrow();
  });
  it('Người dùng Access trong ADMIN_EMAILS là admin, người khác là viewer', async () => {
    const owner = await makeToken(base);
    const app = createApp({ authenticate: authenticate(owner.fetcher) });
    const accEnv = { ...env, ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud-1', ADMIN_EMAILS: 'owner@example.com' };
    const me = await app.request('/api/v1/me', { headers: { 'cf-access-jwt-assertion': owner.token } }, accEnv);
    expect(((await me.json()) as { data: { role: string } }).data.role).toBe('admin');
    const other = await makeToken({ ...base, email: 'guest@example.com' });
    const app2 = createApp({ authenticate: authenticate(other.fetcher) });
    const me2 = await app2.request('/api/v1/me', { headers: { 'cf-access-jwt-assertion': other.token } }, accEnv);
    expect(((await me2.json()) as { data: { role: string } }).data.role).toBe('viewer');
  });
});

describe('Admin token dạng băm (ADMIN_TOKEN_SHA256)', () => {
  it('Token khớp hash ⇒ admin; sai ⇒ 401', async () => {
    const tok = 'a'.repeat(16) + 'b'.repeat(16) + 'c'.repeat(32);
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tok)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const app = createApp();
    const e = { ...env, ADMIN_TOKEN: undefined, ADMIN_TOKEN_SHA256: digest };
    const ok = await app.request('/api/v1/me', { headers: { authorization: `Bearer ${tok}` } }, e);
    expect(((await ok.json()) as { data: { role: string } }).data.role).toBe('admin');
    const bad = await app.request('/api/v1/me', { headers: { authorization: `Bearer ${tok.slice(0, -1)}x` } }, e);
    expect(bad.status).toBe(401);
  });
});

describe('Rate limiting', () => {
  it('Vượt giới hạn ⇒ 429 (bộ đếm fallback khi không có binding)', async () => {
    const app = createApp();
    const { RATE_LIMITER: _omit, ...noLimiter } = env as typeof env & { RATE_LIMITER?: unknown };
    const e = { ...noLimiter, ADMIN_TOKEN: 'another-admin-token-xyz-123' };
    let last = 0;
    for (let i = 0; i < 610; i++) {
      const r = await app.request('/api/v1/games', { headers: { authorization: 'Bearer another-admin-token-xyz-123' } }, e);
      last = r.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});
