import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Áp dụng migrations vào D1 cô lập của mỗi file test (idempotent).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
