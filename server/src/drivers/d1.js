/** Cloudflare D1 driver. */
export function createD1Driver(d1) {
  const bind = (sql, params) => d1.prepare(sql).bind(...params.map((v) => (v === undefined ? null : v)));
  return {
    all: async (sql, params) => (await bind(sql, params).all()).results,
    get: async (sql, params) => (await bind(sql, params).first()) ?? undefined,
    run: async (sql, params) => {
      const r = await bind(sql, params).run();
      return { lastId: Number(r.meta.last_row_id), changes: Number(r.meta.changes) };
    },
    batch: async (stmts) => {
      await d1.batch(stmts.map(([sql, params = []]) => bind(sql, params)));
    },
  };
}
