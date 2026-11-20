// Cấu hình máy cục bộ (không commit): quantum.local.json { "stateDir": "C:\\Users\\…\\AppData\\Local\\QuantumFull\\state", "port": 5190 }
// stateDir: nơi lưu database D1/SQLite cục bộ — nên đặt NGOÀI thư mục OneDrive/Dropbox để tránh hỏng file khi đồng bộ.
import { existsSync, readFileSync } from 'node:fs';

export function readLocalConfig() {
  if (!existsSync('quantum.local.json')) return {};
  try {
    return JSON.parse(readFileSync('quantum.local.json', 'utf8'));
  } catch {
    console.warn('quantum.local.json không hợp lệ — bỏ qua');
    return {};
  }
}

/** Đường dẫn persist cho wrangler (--persist-to) & vite plugin; undefined = mặc định .wrangler/state */
export function stateDir() {
  return readLocalConfig().stateDir || undefined;
}
