/**
 * Dọn dẹp định kỳ (mỗi đêm): giữ các bảng tăng nhanh ở kích thước hợp lý khi công ty có hàng trăm người dùng hằng ngày.
 *  - thông báo đã đọc > 90 ngày, mọi thông báo > 365 ngày
 *  - lịch sử đăng nhập > 180 ngày, nhật ký gửi webhook > 60 ngày
 * Xoá theo lô 5.000 dòng để mỗi câu lệnh ngắn (giới hạn thời gian truy vấn của Cloudflare D1).
 * Nhật ký hoạt động / lịch sử hệ thống (audit) giữ nguyên.
 */
import { run } from './db.js';
import { syncSearch } from './search.js';

const RULES = [
  ['notifications', "is_read = 1 AND created_at < datetime('now', '-90 day')"],
  ['notifications', "created_at < datetime('now', '-365 day')"],
  ['login_logs', "created_at < datetime('now', '-180 day')"],
  ['webhook_logs', "created_at < datetime('now', '-60 day')"],
];

export async function housekeeping({ maxRounds = 20 } = {}) {
  const removed = {};
  for (const [table, where] of RULES) {
    for (let i = 0; i < maxRounds; i++) {
      const { changes } = await run(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE ${where} LIMIT 5000)`);
      removed[table] = (removed[table] || 0) + changes;
      if (changes < 5000) break;
    }
  }
  // Chỉ mục tìm kiếm: xử lý nốt hàng đợi rồi gộp các phân đoạn FTS cho truy vấn nhanh
  try {
    await syncSearch(3);
    await run("INSERT INTO search_fts(search_fts) VALUES ('optimize')");
  } catch { /* không bắt buộc */ }
  try { await run('PRAGMA optimize'); } catch { /* không bắt buộc */ }
  return removed;
}
