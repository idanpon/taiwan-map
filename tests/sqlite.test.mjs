import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {transaction} from '../src/sqlite.mjs';

test('nested writes stay inside the batch and roll back together',()=>{
  const db=openDatabase();
  db.sqlite.exec('CREATE TABLE records(id INTEGER PRIMARY KEY)');
  const insert=id=>db.sqlite.prepare('INSERT INTO records VALUES(?)').run(id);
  const rows=()=>db.sqlite.prepare('SELECT id FROM records ORDER BY id').all().map(r=>r.id);
  try {
    assert.throws(()=>transaction(db,()=>{
      insert(1);
      transaction(db,()=>insert(2));
      throw new Error('Later record failed');
    }),/Later record/);
    assert.deepEqual(rows(),[]);
    transaction(db,()=>{
      insert(3);
      assert.throws(()=>transaction(db,()=>{insert(4);throw new Error('inner')}),/inner/);
      insert(5);
    });
    assert.deepEqual(rows(),[3,5]);
    let called=false;
    assert.throws(()=>transaction(db,async()=>{called=true}),/synchronous/);
    assert.equal(called,false);
    assert.equal(db.sqlite.isTransaction,false);
  } finally {db.close()}
});
