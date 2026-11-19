import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // Nới giới hạn tốc độ trong môi trường test (có test riêng kiểm tra 429).
          ratelimits: { RATE_LIMITER: { namespace_id: "4201", simple: { limit: 100000, period: 60 } } },
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_ENV: 'test',
            ADMIN_TOKEN: 'test-admin-token-0123456789',
            VIEWER_TOKEN: 'test-viewer-token-0123456789',
            ALLOW_DEV_AUTH: 'false',
            ADMIN_EMAILS: 'owner@example.com',
          },
        },
      }),
    ],
    test: {
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/apply-migrations.ts'],
      testTimeout: 60000,
    },
  };
});
