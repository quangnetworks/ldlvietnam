// Áp migration D1 vào database cục bộ (theo quantum.local.json nếu có).
import { execSync } from 'node:child_process';
import { stateDir } from './local-config.mjs';

const dir = stateDir();
const persist = dir ? ` --persist-to "${dir}"` : '';
execSync(`npx wrangler d1 migrations apply quantum-full-db --local${persist}`, { stdio: 'inherit', shell: true, env: { ...process.env, CI: '1' } });
