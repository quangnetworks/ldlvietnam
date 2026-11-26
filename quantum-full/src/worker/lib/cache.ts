/** Lưu đệm kết quả phân tích nặng theo fingerprint dữ liệu (bảng xskt_cache dùng chung); tính lại khi dữ liệu đổi. */
export async function cached<T>(db: D1Database, key: string, fp: string, compute: () => Promise<T>): Promise<{ result: T; cached: boolean; computedAt: string }> {
  const row = await db.prepare('SELECT fingerprint, result_json, computed_at FROM xskt_cache WHERE cache_key = ?').bind(key).first<{ fingerprint: string; result_json: string; computed_at: string }>();
  if (row && row.fingerprint === fp) return { result: JSON.parse(row.result_json) as T, cached: true, computedAt: row.computed_at };
  const result = await compute();
  const at = new Date().toISOString();
  await db
    .prepare('INSERT INTO xskt_cache (cache_key, fingerprint, result_json, computed_at) VALUES (?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET fingerprint = excluded.fingerprint, result_json = excluded.result_json, computed_at = excluded.computed_at')
    .bind(key, fp, JSON.stringify(result), at)
    .run();
  return { result, cached: false, computedAt: at };
}
