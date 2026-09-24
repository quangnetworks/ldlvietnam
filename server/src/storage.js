/**
 * File storage for attachments. Drivers:
 *   Node: local directory.   Cloudflare: R2 bucket.
 * Interface: put(key, file: File|Blob), get(key) -> { body, size } | null, remove(key)
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
    get: async (key) => {
      const obj = await bucket.get(key);
      return obj ? { body: obj.body, size: obj.size } : null;
    },
    remove: async (key) => {
      await bucket.delete(key);
    },
  };
}
