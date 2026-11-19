import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// QUANTUM_E2E=1: dùng thư mục trạng thái D1 cục bộ riêng cho kiểm thử giao diện (không lẫn dữ liệu phát triển).
const e2e = process.env.QUANTUM_E2E === '1';

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ persistState: e2e ? { path: '.wrangler/e2e-state' } : true })],
  server: { port: e2e ? 5191 : 5190, strictPort: e2e },
  preview: { port: 5190 },
  build: { chunkSizeWarningLimit: 1200 },
});
