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
    get: async (key) => {
      const f = file(key);
      if (!fs.existsSync(f)) return null;
      return { body: Readable.toWeb(fs.createReadStream(f)), size: fs.statSync(f).size };
    },
    remove: async (key) => {
      await fs.promises.rm(file(key), { force: true });
    },
  };
}
