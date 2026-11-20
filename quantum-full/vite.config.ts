import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

import { readLocalConfig } from './scripts/local-config.mjs';

// QUANTUM_E2E=1: dùng thư mục trạng thái D1 cục bộ riêng cho kiểm thử giao diện (không lẫn dữ liệu phát triển).
const e2e = process.env.QUANTUM_E2E === '1';
// quantum.local.json (tuỳ chọn, không commit): đặt database cục bộ ngoài thư mục đồng bộ (OneDrive…) và cổng.
const local = (readLocalConfig() ?? {}) as { stateDir?: string; port?: number };

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ persistState: e2e ? { path: '.wrangler/e2e-state' } : local.stateDir ? { path: local.stateDir } : true })],
  server: { port: e2e ? 5191 : (local.port ?? 5190), strictPort: e2e },
  preview: { port: 5190 },
  build: { chunkSizeWarningLimit: 1200 },
});
