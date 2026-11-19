// Chuẩn bị môi trường E2E: D1 cục bộ RIÊNG (.wrangler/e2e-state), áp migrations sạch.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';

rmSync('.wrangler/e2e-state', { recursive: true, force: true });
if (!existsSync('.dev.vars')) copyFileSync('.dev.vars.example', '.dev.vars');
execSync('npx wrangler d1 migrations apply quantum-full-db --local --persist-to .wrangler/e2e-state', { stdio: 'inherit', env: { ...process.env, CI: '1' } });
