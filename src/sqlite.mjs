export const all=(db,sql,...args)=>db.sqlite.prepare(sql).all(...args);
export const one=(db,sql,...args)=>db.sqlite.prepare(sql).get(...args);
export const run=(db,sql,...args)=>db.sqlite.prepare(sql).run(...args);
export function transaction(db,fn){
 db.sqlite.exec('BEGIN IMMEDIATE');
 try{const value=fn();db.sqlite.exec('COMMIT');return value}
 catch(error){db.sqlite.exec('ROLLBACK');throw error}
}
