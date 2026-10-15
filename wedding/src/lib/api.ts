import type { InvitationDesign } from '../data/design';
import type { Guest, GuestStatus } from '../data/types';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError('Không kết nối được máy chủ. Kiểm tra mạng và thử lại.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Lỗi ${res.status}`, res.status);
  return data as T;
}

const post = <T>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

export type GuestInput = Pick<Guest, 'guest_id' | 'guest_name' | 'salutation' | 'display_name' | 'guest_group' | 'note'> & { invitation_status?: GuestStatus };

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export const api = {
  me: () => call<{ admin: boolean }>('/auth/me'),
  login: (password: string) => post<{ ok: true }>('/auth/login', { password }),
  logout: () => post<{ ok: true }>('/auth/logout'),
  changePassword: (current: string, next: string) => post<{ ok: true }>('/auth/password', { current, next }),
  state: () => call<{ guests: Guest[]; design: InvitationDesign | null }>('/state'),
  saveDesign: (d: InvitationDesign) => call<{ ok: true; saved_at: string }>('/design', { method: 'PUT', body: JSON.stringify(d) }),
  createGuest: (g: GuestInput) => post<Guest>('/guests', g),
  updateGuest: (id: string, g: Partial<GuestInput>) => call<Guest>(`/guests/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(g) }),
  deleteGuests: (ids: string[]) => post<{ deleted: number }>('/guests/delete', { ids }),
  importGuests: (rows: GuestInput[], mode: 'skip' | 'overwrite') => post<ImportResult>('/guests/import', { rows, mode }),
  setStatus: (ids: string[], status: GuestStatus) => post<Guest[]>('/guests/status', { ids, status }),
  markSent: (ids: string[]) => post<Guest[]>('/guests/sent', { ids }),
  rotateToken: (id: string) => post<Guest>(`/guests/${encodeURIComponent(id)}/rotate`),
  invite: (token: string, preview = false) => call<{ display_name: string; salutation?: string; design: InvitationDesign | null }>(`/invite/${token}${preview ? '?preview=1' : ''}`),
};

export function inviteUrl(g: Pick<Guest, 'token'>) {
  return g.token ? `${window.location.origin}/t/${g.token}` : '';
}
