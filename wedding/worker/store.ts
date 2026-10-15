import { DurableObject } from 'cloudflare:workers';

/** Một bản ghi khách mời lưu trên máy chủ. `token` là mã bí mật trong link thiệp. */
export interface GuestRow {
  guest_id: string;
  token: string;
  guest_name: string;
  salutation: string;
  display_name: string;
  guest_group: string;
  note: string;
  invitation_status: 'draft' | 'ready' | 'exported' | 'error';
  link_sent_at: string | null;
  opened_at: string | null;
  last_opened_at: string | null;
  open_count: number;
  created_at: string;
  updated_at: string;
}

export type GuestInput = Pick<GuestRow, 'guest_id' | 'guest_name' | 'salutation' | 'display_name' | 'guest_group' | 'note'> &
  Partial<Pick<GuestRow, 'invitation_status'>>;

const STATUSES = new Set(['draft', 'ready', 'exported', 'error']);
const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newToken(len = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of bytes) s += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  return s;
}

const now = () => new Date().toISOString();

/** Làm sạch & kiểm tra dữ liệu khách. Ném lỗi với thông điệp tiếng Việt. */
export function cleanGuest(g: Partial<GuestInput>): GuestInput {
  const str = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const out: GuestInput = {
    guest_id: str(g.guest_id, 40).toUpperCase(),
    guest_name: str(g.guest_name, 120),
    salutation: str(g.salutation, 40),
    display_name: str(g.display_name, 160),
    guest_group: str(g.guest_group, 60),
    note: str(g.note, 300),
  };
  if (g.invitation_status && STATUSES.has(g.invitation_status)) out.invitation_status = g.invitation_status;
  if (!/^[A-Z0-9][A-Z0-9_.-]{0,39}$/.test(out.guest_id)) throw new Error('Mã khách chỉ gồm chữ không dấu, số, dấu - _ .');
  if (!out.guest_name) throw new Error('Thiếu tên khách mời');
  if (!out.display_name) out.display_name = `${out.salutation} ${out.guest_name}`.trim();
  return out;
}

/**
 * Kho dữ liệu duy nhất của website (Durable Object + SQLite).
 * Một instance tên "main" chứa toàn bộ khách mời, thiết kế thiệp và cấu hình đăng nhập.
 */
export class WeddingStore extends DurableObject {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS guests (
        guest_id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        guest_name TEXT NOT NULL,
        salutation TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL,
        guest_group TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        invitation_status TEXT NOT NULL DEFAULT 'ready',
        link_sent_at TEXT,
        opened_at TEXT,
        last_opened_at TEXT,
        open_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  // ——— key/value ———
  getValue(key: string): string | null {
    const r = this.sql.exec<{ value: string }>('SELECT value FROM kv WHERE key = ?', key).toArray()[0];
    return r ? r.value : null;
  }
  setValue(key: string, value: string) {
    this.sql.exec('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  // ——— khách mời ———
  listGuests(): GuestRow[] {
    return this.sql.exec("SELECT * FROM guests ORDER BY created_at, guest_id").toArray() as unknown as GuestRow[];
  }

  private getGuest(id: string): GuestRow | null {
    return (this.sql.exec('SELECT * FROM guests WHERE guest_id = ?', id).toArray()[0] as unknown as GuestRow) ?? null;
  }

  createGuest(input: Partial<GuestInput>): GuestRow {
    const g = cleanGuest(input);
    if (this.getGuest(g.guest_id)) throw new Error(`Mã khách ${g.guest_id} đã tồn tại`);
    const t = now();
    this.sql.exec(
      `INSERT INTO guests (guest_id, token, guest_name, salutation, display_name, guest_group, note, invitation_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      g.guest_id, newToken(), g.guest_name, g.salutation, g.display_name, g.guest_group, g.note, g.invitation_status ?? 'ready', t, t,
    );
    return this.getGuest(g.guest_id)!;
  }

  updateGuest(id: string, input: Partial<GuestInput>): GuestRow {
    const cur = this.getGuest(id);
    if (!cur) throw new Error('Không tìm thấy khách');
    const g = cleanGuest({ ...cur, ...input, guest_id: id });
    this.sql.exec(
      `UPDATE guests SET guest_name = ?, salutation = ?, display_name = ?, guest_group = ?, note = ?, invitation_status = ?, updated_at = ? WHERE guest_id = ?`,
      g.guest_name, g.salutation, g.display_name, g.guest_group, g.note, g.invitation_status ?? cur.invitation_status, now(), id,
    );
    return this.getGuest(id)!;
  }

  deleteGuests(ids: string[]) {
    for (const id of ids) this.sql.exec('DELETE FROM guests WHERE guest_id = ?', id);
    return { deleted: ids.length };
  }

  /** Nhập hàng loạt. mode = 'skip' giữ khách cũ khi trùng mã, 'overwrite' cập nhật nội dung (giữ nguyên link). */
  importGuests(rows: Partial<GuestInput>[], mode: 'skip' | 'overwrite') {
    let created = 0, updated = 0, skipped = 0;
    const errors: Array<{ row: number; message: string }> = [];
    this.ctx.storage.transactionSync(() => {
      rows.forEach((r, i) => {
        try {
          const g = cleanGuest(r);
          if (this.getGuest(g.guest_id)) {
            if (mode === 'overwrite') {
              this.updateGuest(g.guest_id, g);
              updated++;
            } else skipped++;
          } else {
            this.createGuest(g);
            created++;
          }
        } catch (e) {
          errors.push({ row: i + 1, message: (e as Error).message });
        }
      });
    });
    return { created, updated, skipped, errors };
  }

  setStatus(ids: string[], status: GuestRow['invitation_status']) {
    if (!STATUSES.has(status)) throw new Error('Trạng thái không hợp lệ');
    const t = now();
    for (const id of ids) this.sql.exec('UPDATE guests SET invitation_status = ?, updated_at = ? WHERE guest_id = ?', status, t, id);
    return this.listGuests().filter((g) => ids.includes(g.guest_id));
  }

  markSent(ids: string[]) {
    const t = now();
    for (const id of ids) this.sql.exec('UPDATE guests SET link_sent_at = COALESCE(link_sent_at, ?), updated_at = ? WHERE guest_id = ?', t, t, id);
    return this.listGuests().filter((g) => ids.includes(g.guest_id));
  }

  /** Tạo link mới (link cũ hết hiệu lực). */
  rotateToken(id: string) {
    this.sql.exec('UPDATE guests SET token = ?, updated_at = ? WHERE guest_id = ?', newToken(), now(), id);
    return this.getGuest(id);
  }

  /** Dành cho người nhận: tra khách theo token và ghi nhận lượt mở. */
  openInvite(token: string, track: boolean) {
    const g = this.sql.exec('SELECT * FROM guests WHERE token = ?', token).toArray()[0] as unknown as GuestRow | undefined;
    if (!g) return null;
    if (track) {
      const t = now();
      this.sql.exec('UPDATE guests SET opened_at = COALESCE(opened_at, ?), last_opened_at = ?, open_count = open_count + 1 WHERE token = ?', t, t, token);
    }
    return { guest_id: g.guest_id, display_name: g.display_name, salutation: g.salutation, design: this.getValue('design') };
  }

  peekInvite(token: string) {
    const g = this.sql.exec('SELECT display_name FROM guests WHERE token = ?', token).toArray()[0] as unknown as GuestRow | undefined;
    return g ? { display_name: g.display_name } : null;
  }

  // ——— chống dò mật khẩu ———
  loginAllowed(): { ok: boolean; retryAfter: number } {
    const raw = this.getValue('login_fail');
    if (!raw) return { ok: true, retryAfter: 0 };
    const f = JSON.parse(raw) as { count: number; until: number };
    const left = Math.ceil((f.until - Date.now()) / 1000);
    return f.count >= 8 && left > 0 ? { ok: false, retryAfter: left } : { ok: true, retryAfter: 0 };
  }
  recordLogin(success: boolean) {
    if (success) return this.setValue('login_fail', JSON.stringify({ count: 0, until: 0 }));
    const raw = this.getValue('login_fail');
    const f = raw ? (JSON.parse(raw) as { count: number; until: number }) : { count: 0, until: 0 };
    const count = f.until < Date.now() ? 1 : f.count + 1;
    this.setValue('login_fail', JSON.stringify({ count, until: Date.now() + 15 * 60_000 }));
  }

  backup() {
    return { exported_at: now(), design: this.getValue('design'), guests: this.listGuests() };
  }
}
