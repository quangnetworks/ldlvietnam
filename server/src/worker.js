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

const app = createApp();
let ready = false;

export default {
  async fetch(request, env, ctx) {
    if (!ready) {
      setDriver(createD1Driver(env.DB));
      if (env.FILES) setStorage(createR2Storage(env.FILES));
      setPushEnv(env);
      ready = true;
    }
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return app.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
};
