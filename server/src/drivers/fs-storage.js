import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

/** Local-disk storage for the Node.js runtime. */
export function createFsStorage(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (key) => path.join(dir, path.basename(key));
  return {
    put: async (key, blob) => {
      await fs.promises.writeFile(file(key), Buffer.from(await blob.arrayBuffer()));
    },
    get: async (key, range) => {
      const f = file(key);
      if (!fs.existsSync(f)) return null;
      const opts = range ? { start: range.offset, end: range.offset + range.length - 1 } : undefined;
      return { body: Readable.toWeb(fs.createReadStream(f, opts)), size: fs.statSync(f).size };
    },
    size: async (key) => {
      const f = file(key);
      return fs.existsSync(f) ? fs.statSync(f).size : null;
    },
    remove: async (key) => {
      await fs.promises.rm(file(key), { force: true });
    },
  };
}
