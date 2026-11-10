import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { transaction } from '../src/sqlite.mjs';
export function openDatabase(filename = ':memory:') {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  function prepared(sql, args = []) {
    return {
      bind(...values) {
        return prepared(sql, values);
      },
      async first() {
        return sqlite.prepare(sql).get(...args) || null;
      },
      async run() {
        const r = sqlite.prepare(sql).run(...args);
        return { meta: { changes: Number(r.changes) } };
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...args) };
      },
      execute() {
        const s = sqlite.prepare(sql);
        if (s.columns().length) {
          const results = s.all(...args);
          return {
            results,
            meta: { changes: Number(sqlite.prepare('SELECT changes() n').get().n) },
          };
        }
        const r = s.run(...args);
        return { results: [], meta: { changes: Number(r.changes) } };
      },
    };
  }
  const db = {
    prepare: (sql) => prepared(sql),
    async batch(statements, { validate } = {}) {
      return transaction(db, () => {
        const r = statements.map((s) => s.execute());
        validate?.(r);
        return r;
      });
    },
    sqlite,
    close: () => sqlite.close(),
  };
  return db;
}
export function migrate(db, directory) {
  db.sqlite.exec(
    'CREATE TABLE IF NOT EXISTS _app_migrations(name TEXT PRIMARY KEY,hash TEXT NOT NULL,applied_at INTEGER NOT NULL)',
  );
  for (const name of readdirSync(directory)
    .filter((n) => /^\d+.*\.sql$/.test(n))
    .sort()) {
    const sql = readFileSync(resolve(directory, name), 'utf8'),
      hash = createHash('sha256').update(sql).digest('hex');
    const previous = db.sqlite.prepare('SELECT hash FROM _app_migrations WHERE name=?').get(name);
    if (previous) {
      if (previous.hash !== hash) throw new Error('Applied migration was changed: ' + name);
      continue;
    }
    // A table rebuild must bypass the old parent's ON DELETE actions. Check
    // every FK before committing and restore enforcement even after a failure.
    const rebuild = sql.startsWith('-- rebuild-foreign-keys\n');
    if (rebuild && db.sqlite.isTransaction)
      throw new Error('Cannot rebuild foreign keys inside another transaction');
    if (rebuild) db.sqlite.exec('PRAGMA foreign_keys=OFF');
    try {
      transaction(db, () => {
        db.sqlite.exec(sql);
        if (rebuild && db.sqlite.prepare('PRAGMA foreign_key_check').get())
          throw new Error('Foreign key check failed in ' + name);
        db.sqlite.prepare('INSERT INTO _app_migrations VALUES(?,?,?)').run(name, hash, Date.now());
      });
    } finally {
      if (rebuild) db.sqlite.exec('PRAGMA foreign_keys=ON');
    }
  }
}
