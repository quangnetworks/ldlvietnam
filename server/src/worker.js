/**
 * Cloudflare Worker entry. Bindings (see wrangler.toml):
 *   DB     – D1 database          FILES  – R2 bucket for attachments
 *   ASSETS – built React client   JWT_SECRET (optional secret)
 */
import { createApp } from './app.js';
import { setDriver } from './db.js';
import { setStorage, createR2Storage } from './storage.js';
import { createD1Driver } from './drivers/d1.js';
import { setPushEnv } from './push.js';
import { housekeeping } from './maintenance.js';

const app = createApp();
let ready = false;
function init(env) {
  if (ready) return;
  setDriver(createD1Driver(env.DB));
  if (env.FILES) setStorage(createR2Storage(env.FILES));
  setPushEnv(env);
  ready = true;
}

export default {
  async fetch(request, env, ctx) {
    init(env);
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return app.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
  // Cron (wrangler.toml → [triggers]): dọn dẹp dữ liệu cũ mỗi đêm
  async scheduled(event, env, ctx) {
    init(env);
    ctx.waitUntil(housekeeping().then((r) => console.log('housekeeping', JSON.stringify(r))));
  },
};
