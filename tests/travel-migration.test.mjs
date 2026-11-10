import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import { migrate, openDatabase } from '../server/database.mjs';
import { seed } from '../src/seed.mjs';
import { all, one, run } from '../src/sqlite.mjs';

test('schema upgrade on a SQLite backup guards assigned custom statuses and preserves planner references',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'taiwan-travel-migration-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 for(const name of readdirSync('drizzle').filter(name=>name<'0011'))copyFileSync(join('drizzle',name),join(dir,name));
 const original=openDatabase(join(dir,'original.sqlite'));
 const trip='taiwan-2026',user='trip-shared';
 let copy;
 try{
  migrate(original,dir);await seed(original);
  run(original,"INSERT INTO statuses(id,trip_id,label,color,sort_order) VALUES('hype',?,'Legacy','#ff0000',42)",trip);
  run(original,"UPDATE statuses SET color='#123456',symbol='+',dimmed=1 WHERE id='want'");
  run(original,"UPDATE places SET hidden=1 WHERE id='taipei-101'");
  run(original,"INSERT INTO user_place_states VALUES(?,'taipei-101','hype','Keep place note',7,1)",user);
  run(original,"INSERT INTO state_events VALUES('status-event',?,'taipei-101','hype','Keep place note',7,1)",user);
  for(const [id,kind] of [['historic-decision','decision'],['historic-visit','visit']])
   run(original,"INSERT INTO planning_items(id,trip_id,kind,title,note,date_start,version,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,'2027-01-07',5,?,?,1,1)",id,trip,kind,id,'Keep plan note',user,user);
  run(original,"INSERT INTO planning_options VALUES('historic-option','historic-decision','Option','Keep option',0)");
  run(original,"INSERT INTO planning_item_places VALUES('historic-place','historic-decision','historic-option','taipei-101','Taipei 101',1,'keep')");
  run(original,"INSERT INTO planning_dependencies VALUES('historic-visit','historic-decision')");
  run(original,"INSERT INTO planning_events VALUES('plan-event',?,'historic-visit',?,'update','{}',1)",trip,user);
  run(original,"INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('session-hash',?,100000)",user);
  run(original,"INSERT INTO push_devices(id,user_id,session_hash,installation_id,name,endpoint,p256dh,auth,enabled_from,last_seen) VALUES('device',?,'session-hash','installation','Fixture','https://example.test/push','p','a',1,1)",user);
  run(original,"INSERT INTO planning_reminders(id,user_id,item_id,enabled,mode,local_time,fires_at,updated_at) VALUES('reminder',?,'historic-visit',1,'day','10:00',9999,1)",user);
  run(original,"INSERT INTO push_deliveries(id,reminder_id,generation,device_id,state,next_at,expires_at) VALUES('delivery','reminder',1,'device','queued',9999,10000)");
  const path=join(dir,'copy.sqlite');
  await backup(original.sqlite,path);
  copy=openDatabase(path);
  const tables=['planning_items','planning_options','planning_item_places','planning_dependencies',
   'planning_events','planning_reminders','push_deliveries','state_events','user_place_states'];
  const snapshot=()=>Object.fromEntries(tables.map(table=>[table,all(copy,'SELECT * FROM '+table+' ORDER BY rowid')]));
  const before=snapshot();
  assert.throws(()=>migrate(copy,'drizzle'),/review_custom_status_assignments_before_upgrade/);
  assert.deepEqual(snapshot(),before);
  assert.equal(one(copy,'PRAGMA foreign_keys').foreign_keys,1);
  assert.equal(one(copy,"SELECT archived FROM statuses WHERE id='hype'").archived,0);
  assert.equal(one(copy,"SELECT count(*) n FROM _app_migrations WHERE name LIKE '0011%'").n,0);

  // Simulate a reviewed reclassification before rerunning the migration.
  run(copy,"UPDATE user_place_states SET status_id='want',version=8 WHERE place_id='taipei-101'");
  const reviewed=snapshot();
  migrate(copy,'drizzle');migrate(copy,'drizzle');
  reviewed.planning_items=reviewed.planning_items.map(row=>Object.assign(row,{transport_json:null}));
  reviewed.planning_item_places=reviewed.planning_item_places.map(row=>Object.assign(row,{role:null}));
  assert.deepEqual(snapshot(),reviewed);
  assert.equal(one(copy,"SELECT archived FROM statuses WHERE id='hype'").archived,1);
  assert.deepEqual({...one(copy,"SELECT color,symbol,dimmed FROM statuses WHERE id='want'")},{color:'#123456',symbol:'+',dimmed:1});
  assert.deepEqual(all(copy,'PRAGMA foreign_key_check'),[]);
  assert.equal(one(copy,'PRAGMA integrity_check').integrity_check,'ok');
  assert.equal(one(original,"SELECT status_id FROM user_place_states").status_id,'hype');
  run(copy,"DELETE FROM planning_items WHERE id='historic-visit'");
  assert.equal(one(copy,'SELECT count(*) n FROM push_deliveries').n,0);
  assert.equal(one(copy,"SELECT item_id FROM planning_events WHERE id='plan-event'").item_id,null);
 }finally{copy?.close();original.close()}
});
