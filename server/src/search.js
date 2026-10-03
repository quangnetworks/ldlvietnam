/**
 * Tìm kiếm toàn hệ thống LDL — chỉ mục toàn văn SQLite FTS5 (chạy được cả Node lẫn Cloudflare D1).
 *
 * - Chữ được chuẩn hoá trước khi lập chỉ mục và trước khi tìm: bỏ dấu tiếng Việt, đ→d, chữ thường, bỏ thẻ HTML,
 *   tách chữ / số dính nhau trong mã ("LDL0123" → "ldl 0123"). Nhờ vậy "quyet dinh", "QUYẾT ĐỊNH", "quyết định"
 *   đều khớp nhau; các từ khoá không cần đúng thứ tự; từ cuối gõ dở vẫn khớp (tìm theo tiền tố).
 * - Xếp hạng BM25: khớp ở tên / mã (cột title) nặng gấp 6 lần khớp ở nội dung (cột body).
 * - rowid = mã loại × 10^10 + id bản ghi. Trigger (migration 0029) ghi bản ghi vừa thêm / sửa / xoá vào
 *   search_queue; syncSearch() lập lại chỉ mục cho các bản ghi đó trước mỗi lần tìm — không cần sửa từng chỗ ghi dữ liệu.
 * - Quyền xem do từng module tự lọc: hàm ở đây chỉ trả id ứng viên theo thứ tự liên quan.
 */
import { all, batch } from './db.js';

const BASE = 10000000000;

const html = (s) => String(s ?? '')
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&[a-z#0-9]+;/gi, ' ');

/** Chuẩn hoá để so khớp: bỏ dấu, đ→d, chữ thường, tách chữ-số, gộp khoảng trắng. */
export function fold(s) {
  return html(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
    .replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ').trim();
}

const join = (...xs) => xs.filter((x) => x != null && x !== '').join(' ');
const jsonText = (v) => { // giá trị chữ / số trong dữ liệu biểu mẫu đề xuất
  try {
    const out = [];
    const walk = (x) => { if (x == null) return; if (typeof x === 'object') Object.values(x).forEach(walk); else out.push(String(x)); };
    walk(typeof v === 'string' ? JSON.parse(v) : v);
    return out.join(' ');
  } catch { return ''; }
};

/** Loại dữ liệu được lập chỉ mục: mã (cố định — nằm trong rowid), câu lấy dữ liệu, cột tên & nội dung. */
const ENTITIES = {
  document: { code: 1, sql: `SELECT d.id, d.title, d.code, d.description, d.content, d.sender_org, t.name AS type_name
      FROM documents d LEFT JOIN doc_types t ON t.id = d.type_id WHERE d.id IN (SELECT value FROM json_each(?))`,
    title: (r) => join(r.code, r.title), body: (r) => join(r.description, r.type_name, r.sender_org, r.content) },
  task: { code: 2, sql: 'SELECT id, title, description FROM tasks WHERE id IN (SELECT value FROM json_each(?))',
    title: (r) => r.title, body: (r) => r.description },
  project: { code: 3, sql: 'SELECT id, name, description FROM projects WHERE id IN (SELECT value FROM json_each(?))',
    title: (r) => r.name, body: (r) => r.description },
  goal: { code: 4, sql: 'SELECT id, title, description FROM goals WHERE id IN (SELECT value FROM json_each(?))',
    title: (r) => r.title, body: (r) => r.description },
  request: { code: 5, sql: 'SELECT id, title, content, data FROM requests WHERE id IN (SELECT value FROM json_each(?))',
    title: (r) => r.title, body: (r) => join(r.content, jsonText(r.data)) },
  drive: { code: 6, sql: 'SELECT id, name FROM drive_items WHERE id IN (SELECT value FROM json_each(?))',
    title: (r) => r.name, body: () => '' },
  user: { code: 7, sql: `SELECT u.id, u.name, u.username, u.email, u.phone, u.title, h.employee_code, h.office, h.job_position
      FROM users u LEFT JOIN hr_profiles h ON h.user_id = u.id WHERE u.id IN (SELECT value FROM json_each(?))`,
    title: (r) => join(r.name, r.username, r.employee_code), body: (r) => join(r.email, r.phone, r.title, r.office, r.job_position) },
  asset: { code: 8, sql: 'SELECT id, name, code, serial, location, supplier, note FROM assets WHERE id IN (SELECT value FROM json_each(?))',
    title: (r) => join(r.code, r.name, r.serial), body: (r) => join(r.location, r.supplier, r.note) },
  chat: { code: 9, sql: 'SELECT id, content, original_name FROM chat_messages WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))',
    title: (r) => r.original_name, body: (r) => r.content },
};
const BY_CODE = Object.fromEntries(Object.entries(ENTITIES).map(([k, v]) => [v.code, k]));
const MAX_BODY = 20000;

let syncing = null;
/** Lập lại chỉ mục cho các bản ghi trong hàng đợi (tối đa `rounds` × 400 bản ghi mỗi lần gọi). */
// Mặc định 2 vòng (≈ 800 bản ghi, ~25 truy vấn) để một lần tìm không vượt giới hạn truy vấn / request của D1;
// phần tồn đọng lớn (lần đầu lập chỉ mục) do tác vụ bảo trì định kỳ xử lý tiếp.
export function syncSearch(rounds = 2) {
  // Gộp các lần gọi đồng thời (Node) vào một lượt đồng bộ
  if (!syncing) syncing = runSync(rounds).finally(() => { syncing = null; });
  return syncing;
}

async function runSync(rounds) {
  for (let i = 0; i < rounds; i++) {
    const queued = (await all('SELECT rid FROM search_queue LIMIT 400')).map((r) => Number(r.rid));
    if (!queued.length) return;
    // nhận việc trước (xoá khỏi hàng đợi) rồi mới đọc dữ liệu: bản ghi bị sửa trong lúc này sẽ được xếp hàng lại
    await batch([['DELETE FROM search_queue WHERE rid IN (SELECT value FROM json_each(?))', [JSON.stringify(queued)]]]);
    const groups = {};
    for (const rid of queued) (groups[Math.floor(rid / BASE)] ||= []).push(rid % BASE);
    const stmts = [['DELETE FROM search_fts WHERE rowid IN (SELECT value FROM json_each(?))', [JSON.stringify(queued)]]];
    for (const [code, ids] of Object.entries(groups)) {
      const def = ENTITIES[BY_CODE[code]];
      if (!def) continue;
      const rows = await all(def.sql, JSON.stringify(ids));
      const docs = rows.map((r) => [Number(code) * BASE + r.id, fold(def.title(r)), fold(def.body(r)).slice(0, MAX_BODY)]);
      if (docs.length) {
        stmts.push([`INSERT INTO search_fts(rowid, title, body)
          SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]') FROM json_each(?)`, [JSON.stringify(docs)]]);
      }
    }
    await batch(stmts);
  }
}

/** Câu truy vấn FTS5 từ chuỗi người dùng gõ: mọi từ đều phải có (theo tiền tố). null nếu không có từ nào. */
export function ftsQuery(text) {
  const words = [...new Set(fold(text).split(/[^a-z0-9]+/).filter(Boolean))].slice(0, 12);
  return words.length ? words.map((w) => `"${w}"*`).join(' ') : null;
}

/**
 * Id các bản ghi loại `entity` khớp `text`, xếp theo mức liên quan (tối đa `limit`).
 * Trả null khi không có từ khoá hợp lệ (vd. chỉ gõ dấu câu) để nơi gọi bỏ qua điều kiện tìm.
 */
export async function searchIds(entity, text, limit = 2000) {
  const match = ftsQuery(text);
  if (!match) return null;
  await syncSearch();
  const lo = ENTITIES[entity].code * BASE;
  const rows = await all(`SELECT rowid - ? AS id FROM search_fts WHERE search_fts MATCH ? AND rowid BETWEEN ? AND ?
    ORDER BY bm25(search_fts, 6.0, 1.0) LIMIT ?`, lo, match, lo + 1, lo + BASE - 1, limit);
  return rows.map((r) => Number(r.id));
}

/**
 * Điều kiện SQL cho danh sách của module: `sql` lọc cột `col` theo kết quả tìm, `rank` là biểu thức xếp hạng
 * (0 = liên quan nhất) để đặt đầu ORDER BY. Id là số nguyên lấy từ CSDL nên ghép thẳng vào câu SQL an toàn.
 * Trả null khi không có từ khoá hợp lệ.
 */
export async function searchClause(entity, text, col) {
  const ids = await searchIds(entity, text);
  if (!ids) return null;
  // rank NULL (không phải 0: "ORDER BY 0" bị SQLite hiểu là số thứ tự cột)
  if (!ids.length) return { sql: '0', rank: 'NULL', ids };
  const list = ids.join(',');
  return { sql: `${col} IN (${list})`, rank: `(SELECT key FROM json_each('[${list}]') WHERE value = ${col})`, ids };
}

/** Lập chỉ mục toàn bộ (dùng khi cần dựng lại từ đầu, vd. sau khi khôi phục dữ liệu). */
export async function rebuildSearch() {
  const stmts = [['DELETE FROM search_fts', []]];
  for (const [, def] of Object.entries(ENTITIES)) {
    const table = def.sql.match(/FROM (\w+)/)[1];
    stmts.push([`INSERT OR IGNORE INTO search_queue(rid) SELECT ${def.code * BASE} + id FROM ${table}`, []]);
  }
  await batch(stmts);
  for (;;) {
    const left = (await all('SELECT COUNT(*) AS n FROM search_queue'))[0].n;
    if (!left) return;
    await runSync(10);
  }
}
