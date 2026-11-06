export const all = (db, sql, ...args) => db.sqlite.prepare(sql).all(...args);
export const one = (db, sql, ...args) => db.sqlite.prepare(sql).get(...args);
export const run = (db, sql, ...args) => db.sqlite.prepare(sql).run(...args);
let savepointId = 0;
// Callbacks must be synchronous: never keep the shared connection locked
// across an await. Savepoints make a complete CLI batch atomic while reusing
// the same per-record service and its validation.
export function transaction(db, fn) {
  if (fn.constructor.name === 'AsyncFunction')
    throw new TypeError('SQLite transaction callbacks must be synchronous');
  const nested = db.sqlite.isTransaction,
    name = 'app_' + ++savepointId;
  db.sqlite.exec(nested ? 'SAVEPOINT ' + name : 'BEGIN IMMEDIATE');
  try {
    const value = fn();
    if (value && typeof value.then === 'function')
      throw new TypeError('SQLite transaction callbacks must be synchronous');
    db.sqlite.exec(nested ? 'RELEASE SAVEPOINT ' + name : 'COMMIT');
    return value;
  } catch (error) {
    db.sqlite.exec(
      nested ? 'ROLLBACK TO SAVEPOINT ' + name + '; RELEASE SAVEPOINT ' + name : 'ROLLBACK',
    );
    throw error;
  }
}
