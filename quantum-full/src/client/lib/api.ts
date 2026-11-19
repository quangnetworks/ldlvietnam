/** Client gọi API /api/v1. Production: xác thực qua Cloudflare Access (cookie). Tuỳ chọn: API token lưu cục bộ. */
const TOKEN_KEY = 'quantum.apiToken';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* bỏ qua */
  }
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface Envelope<T> {
  data: T;
  meta?: Record<string, any>;
}

export async function apiFetch<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<Envelope<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: opts.signal, credentials: 'same-origin' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiClientError(0, 'network', 'Không kết nối được máy chủ');
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiClientError(res.status, 'bad_response', `Phản hồi không hợp lệ (${res.status})`);
  }
  if (!res.ok) throw new ApiClientError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? `Lỗi ${res.status}`, json?.error?.details);
  return json as Envelope<T>;
}
