import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/** Node.js driver backed by the built-in node:sqlite module. */
export function createNodeDriver(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)');
  for (const name of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    if (db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(name)) continue;
    db.exec(fs.readFileSync(path.join(MIGRATIONS, name), 'utf8'));
    db.prepare('INSERT INTO _migrations(name) VALUES (?)').run(name);
  }
  const norm = (row) => (row ? { ...row } : undefined);
  return {
    all: async (sql, params) => db.prepare(sql).all(...params).map(norm),
    get: async (sql, params) => norm(db.prepare(sql).get(...params)),
    run: async (sql, params) => {
      const r = db.prepare(sql).run(...params);
      return { lastId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    batch: async (stmts) => {
      db.exec('BEGIN');
      try {
        for (const [sql, params = []] of stmts) db.prepare(sql).run(...params);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    exec: (sql) => db.exec(sql),
  };
}
