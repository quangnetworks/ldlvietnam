/**
 * File storage for attachments. Drivers:
 *   Node: local directory.   Cloudflare: R2 bucket.
 * Interface: put(key, file: File|Blob), get(key, range?: { offset, length }) -> { body, size } | null, remove(key)
 *   (size is always the full object size; with a range only that slice is streamed)
 */
let storage = null;

export function setStorage(s) {
  storage = s;
}
export function getStorage() {
  if (!storage) throw new Error('Chưa cấu hình nơi lưu tệp');
  return storage;
}

export function createR2Storage(bucket) {
  return {
    put: async (key, file) => {
      await bucket.put(key, file.stream ? file.stream() : file, { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
    },
    get: async (key, range) => {
      const obj = await bucket.get(key, range ? { range } : undefined);
      return obj ? { body: obj.body, size: obj.size } : null;
    },
    size: async (key) => (await bucket.head(key))?.size ?? null,
    remove: async (key) => {
      await bucket.delete(key);
    },
  };
}
