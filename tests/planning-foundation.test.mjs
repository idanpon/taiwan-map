import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backup } from 'node:sqlite';
import { openDatabase, migrate } from '../server/database.mjs';
import { rehearsePlanningUpgrade } from '../server/rehearse-planning-upgrade.mjs';
import { seed } from '../src/seed.mjs';
import { all, one, run, transaction } from '../src/sqlite.mjs';
import { TRIP, sha } from '../src/auth.mjs';
import { handle } from '../src/core.mjs';
import { applyPlanningChange } from '../src/planning.mjs';
import { applyOperations } from '../src/assistant-changes.mjs';
import { importPlanning } from '../server/import-planning.mjs';
import { upgradePlanningModel } from '../src/planning-upgrade.mjs';
import { readSources, fingerprint, insertRow } from '../src/planning-domain-store.mjs';
import { readModel3, evaluatePlanning, createChangeset, getChangeset, updateChangeset, previewChangeset, applyChangeset, applyMetadataCommands } from '../src/planning-command-service.mjs';

const now=Date.parse('2030-01-01T00:00:00Z');
const code=expected=>error=>error.details?.code===expected;
async function fixture({upgrade=true}={}){
  const db=openDatabase();migrate(db,'drizzle');await seed(db);
  run(db,"INSERT INTO app_meta(key,value) VALUES('accounts_v1','shared')");
  const users={};
  for(const [id,role] of [['editor','editor'],['other','editor'],['viewer','viewer']]){
    run(db,'INSERT INTO users(id,display_name,created_at) VALUES(?,?,1)',id,id);
    run(db,'INSERT INTO memberships VALUES(?,?,?)',TRIP,id,role);users[id]={id,role};
  }
  const tokens={editor:'1'.repeat(64),other:'2'.repeat(64),viewer:'3'.repeat(64)};
  for(const [id,token] of Object.entries(tokens))
    run(db,'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',await sha(token),id,Date.now()+86400000);
  const env={DB:db,APP_ORIGIN:'https://api.example',AUTH_MODE:'bearer'};
  const call=(path,method='GET',data,actor='editor')=>handle(new Request(env.APP_ORIGIN+path,{method,headers:{Origin:env.APP_ORIGIN,...(actor?{Authorization:'Bearer '+tokens[actor]}:{}),...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
  async function legacy(data,id){
    return (await applyPlanningChange(db,users.editor,{path:'/api/planning/items',method:'POST',body:data,creationId:id}).json()).item;
  }
  function ready(commands,actor=users.editor){
    const d=createChangeset(db,actor,{version:3,commands},now);
    return previewChangeset(db,actor,d.id,{version:d.version},now);
  }
  function apply(p,key=crypto.randomUUID(),actor=users.editor,time=now){
    return applyChangeset(db,actor,p.id,{version:p.version,fingerprint:p.preview.fingerprint,idempotency_key:key},time);
  }
  if(upgrade)upgradePlanningModel(db,users.editor,now);
  return {db,users,call,legacy,ready,apply};
}
function newVisit(title='Visit'){return {key:'visit',type:'create_item',data:{kind:'visit',title,note:'Keep note'}};}
function timedVisit(){
  return [
    {key:'slot',type:'upsert_placement',id:{command:'visit',entity:'placement'},expected_version:1,data:{precision:'exact',starts_at:'2035-01-04T08:00:00.000Z',ends_at:'2035-01-04T09:00:00.000Z',start_timezone:'Asia/Taipei',end_timezone:'Asia/Taipei'}},
    {key:'place',type:'link_place',placement_id:{command:'visit',entity:'placement'},expected_version:0,data:{place_id:'taipei-101',role:'visit',selection:'chosen'}},
    newVisit(),
  ];
}
const row=(f,collection,id)=>readSources(f.db).sources[collection].find(x=>x.id===id);

test('upgrade rehearsal on a SQLite backup preserves facts, IDs, history and reminders; source stays unchanged',async t=>{
  const f=await fixture({upgrade:false}),directory=mkdtempSync(join(tmpdir(),'taiwan-route-rehearsal-'));
  t.after(()=>{f.db.close();rmSync(directory,{recursive:true,force:true});});
  const task=await f.legacy({kind:'task',title:'Buy',date_end:'2035-01-02',note:'Personal note',state:'done'},'legacy-task');
  await f.legacy({kind:'task',title:'Work period',date_start:'2035-01-01',date_end:'2035-01-02'},'period-task');
  await f.legacy({kind:'visit',title:'Visited',state:'done',date_start:'2035-01-04',fixed_external:true,places:[{place_id:'taipei-101'}]},'past-visit');
  await f.legacy({kind:'stay',title:'Hotel',date_start:'2035-01-04',date_end:'2035-01-07',places:[{place_id:'taipei-101',role:'lodging'}]},'legacy-hotel');
  await f.legacy({kind:'transport',title:'Flight',date_start:'2035-01-04',date_end:'2035-01-04',event_timezone:'Asia/Taipei',
    transport:{mode:'plane',arrival_timezone:'Asia/Tokyo'},places:[{role:'departure',place_name:'Taipei'},{role:'arrival',place_name:'Tokyo'}]},'legacy-flight');
  run(f.db,"INSERT INTO planning_reminders(id,user_id,item_id,enabled,mode,local_time,generation,sent_generation,updated_at) VALUES('sent-rule','editor',?,1,'day','10:00',4,4,1)",task.id);
  const original=join(directory,'source.sqlite');await backup(f.db.sqlite,original);
  const before=fingerprint(readSources(f.db));
  const report=await rehearsePlanningUpgrade(original,join(directory,'result'),'editor');
  assert.deepEqual(report.counts,{items:5,placements:3,links:4,stays:1,targets:1});
  assert.equal(report.source_unchanged,true);assert.equal(report.legacy_rows_preserved,true);
  assert.equal(report.repeat_idempotent,true);
  const copy=openDatabase(join(directory,'result','upgraded.sqlite'));t.after(()=>copy.close());
  assert.equal(one(copy,"SELECT note FROM planning_items WHERE id='legacy-task'").note,'Personal note');
  assert.equal(one(copy,"SELECT version FROM planning_items WHERE id='legacy-task'").version,task.version);
  assert.equal(one(copy,"SELECT completion_snapshot_json FROM planning_items WHERE id='past-visit'").completion_snapshot_json,null);
  assert.equal(one(copy,"SELECT count(*) n FROM planning_deadlines WHERE task_id='period-task'").n,0);
  assert.equal(one(copy,"SELECT generation FROM planning_reminders WHERE id='sent-rule'").generation,4);
  assert.equal(one(copy,"SELECT sent_generation FROM planning_reminders WHERE id='sent-rule'").sent_generation,4);
  assert.equal(one(copy,'SELECT count(*) n FROM booking_services').n,1);
  assert.equal(one(copy,'SELECT capacity_units FROM booking_services').capacity_units,null);
  assert.equal(one(copy,"SELECT end_timezone FROM planning_placements WHERE item_id='legacy-flight'").end_timezone,'Asia/Tokyo');
  const mapped=all(copy,'SELECT * FROM planning_migration_refs ORDER BY target_id');
  upgradePlanningModel(copy,f.users.editor);assert.deepEqual(all(copy,'SELECT * FROM planning_migration_refs ORDER BY target_id'),mapped);
  assert.equal(fingerprint(readSources(f.db)),before);
  assert.equal(JSON.parse(readFileSync(join(directory,'result','report.json'))).integrity,'ok');
});

test('failed upgrade rolls back root, converted fields, bookings, revision and migration journal',async t=>{
  const f=await fixture({upgrade:false});t.after(()=>f.db.close());
  await f.legacy({kind:'visit',title:'Valid',date_start:'2035-01-01'},'first');
  run(f.db,"INSERT INTO planning_items(id,trip_id,kind,title,created_by,updated_by,created_at,updated_at) VALUES('zz-invalid',?,'stay','Invalid','editor','editor',1,1)",TRIP);
  const before=fingerprint(readSources(f.db)),events=all(f.db,'SELECT * FROM planning_events');
  assert.throws(()=>upgradePlanningModel(f.db,f.users.editor,now),code('MIGRATION_INVALID_STAY'));
  assert.equal(fingerprint(readSources(f.db)),before);
  assert.deepEqual(all(f.db,'SELECT * FROM planning_events'),events);
  assert.equal(one(f.db,'SELECT count(*) n FROM planning_migration_refs').n,0);
  assert.deepEqual(all(f.db,'PRAGMA foreign_key_check'),[]);
});

test('rehearsal applies new DDL and conversion to a pre-0014 database copy',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'taiwan-route-old-schema-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const migrations=join(directory,'migrations');mkdirSync(migrations);
  for(const file of readdirSync('drizzle').filter(name=>name<'0014'))copyFileSync(join('drizzle',file),join(migrations,file));
  const file=join(directory,'legacy.sqlite'),db=openDatabase(file);t.after(()=>db.close());
  migrate(db,migrations);await seed(db);
  for(const [id,kind,start,end] of [['legacy-stay','stay','2035-01-04','2035-01-07'],['legacy-task','task',null,'2035-01-02']])
    run(db,"INSERT INTO planning_items(id,trip_id,kind,title,note,date_start,date_end,version,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,7,'trip-shared','trip-shared',1,1)",id,TRIP,kind,'Fixture '+kind,'Unchanged note',start,end);
  run(db,"INSERT INTO planning_item_places(id,item_id,place_id,place_name,role) VALUES('stable-link','legacy-stay','taipei-101','Fixture hotel','lodging')");
  run(db,"INSERT INTO planning_events(id,trip_id,item_id,actor_id,action,payload,created_at) VALUES('history',?,'legacy-stay','trip-shared','create','{}',1)",TRIP);
  run(db,"INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('fixture-session','trip-shared',1)");
  run(db,"INSERT INTO push_devices(id,user_id,session_hash,installation_id,name,endpoint,p256dh,auth,enabled_from,last_seen) VALUES('fixture-device','trip-shared','fixture-session','fixture','Fixture','https://example.test/push','p','a',1,1)");
  run(db,"INSERT INTO planning_reminders(id,user_id,item_id,enabled,mode,local_time,generation,sent_generation,updated_at) VALUES('historical-rule','trip-shared','legacy-task',1,'day','10:00',3,3,1)");
  run(db,"INSERT INTO push_deliveries(id,reminder_id,generation,device_id,state,next_at,expires_at) VALUES('sent','historical-rule',3,'fixture-device','sent',1,2)");
  const report=await rehearsePlanningUpgrade(file,join(directory,'upgraded'),'trip-shared');
  assert.equal(report.legacy_rows_preserved,true);assert.equal(report.source_unchanged,true);
  assert.equal(report.counts.stays,1);assert.equal(report.counts.targets,1);
  assert.equal(one(db,"SELECT count(*) n FROM _app_migrations WHERE name LIKE '0014%'").n,0);
  const migrated=openDatabase(join(directory,'upgraded','upgraded.sqlite'));t.after(()=>migrated.close());
  assert.equal(one(migrated,"SELECT count(*) n FROM _app_migrations WHERE name LIKE '0014%'").n,1);
  assert.equal(one(migrated,"SELECT state FROM push_deliveries WHERE id='sent'").state,'sent');
  assert.equal(one(migrated,"SELECT version FROM planning_items WHERE id='legacy-stay'").version,7);
});

test('explicit gate, private drafts, viewer evaluate and fresh membership checks',async t=>{
  const f=await fixture({upgrade:false});t.after(()=>f.db.close());
  assert.equal((await f.call('/api/planning?model=3')).status,409);
  upgradePlanningModel(f.db,f.users.editor,now);
  assert.equal((await f.call('/api/planning?model=3','GET',undefined,'')).status,401);
  assert.equal((await f.call('/api/planning?model=3','GET',undefined,'viewer')).status,200);
  const before=fingerprint(readSources(f.db));
  assert.equal((await f.call('/api/planning/evaluate','POST',{version:3,commands:[newVisit()]},'viewer')).status,200);
  assert.equal(fingerprint(readSources(f.db)),before);
  assert.equal(one(f.db,'SELECT count(*) n FROM planning_changesets').n,0);
  assert.equal((await f.call('/api/planning/changesets','POST',{version:3,commands:[newVisit()]},'viewer')).status,403);
  const p=f.ready([newVisit()]);
  assert.equal((await f.call('/api/planning/changesets/'+p.id,'GET',undefined,'other')).status,404);
  run(f.db,"UPDATE memberships SET role='viewer' WHERE user_id='editor'");
  assert.throws(()=>f.apply(p),code('PLANNING_ACCESS_DENIED'));
  run(f.db,"DELETE FROM memberships WHERE user_id='editor'");
  assert.throws(()=>getChangeset(f.db,f.users.editor,p.id),code('PLANNING_ACCESS_DENIED'));
});

test('unordered typed commands create one item/placement; preview is read-only and apply is idempotent',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  const before=fingerprint(readSources(f.db)),p=f.ready(timedVisit());
  assert.equal(fingerprint(readSources(f.db)),before);
  const result=f.apply(p,'once'),again=f.apply(p,'once');
  assert.deepEqual(again,result);
  const s=readModel3(f.db,f.users.viewer,now);
  assert.equal(s.sources.items.length,1);assert.equal(s.sources.placements.length,1);
  assert.equal(s.sources.items[0].note,'Keep note');
  assert.equal(s.sources.items[0].date_start,'2035-01-04');
  assert.equal(s.sources.placements[0].commitment,'tentative');
  assert.equal(s.capabilities.approved_slots,true);
  assert.equal(s.derived.completeness.schedule,'supported');
  assert.equal(one(f.db,'SELECT count(*) n FROM planning_operations').n,1);
  assert.equal(all(f.db,"SELECT * FROM planning_events WHERE action='model3_apply'").length,1);
  assert.throws(()=>applyChangeset(f.db,f.users.editor,p.id,{version:p.version,fingerprint:'other',idempotency_key:'once'},now),code('IDEMPOTENCY_CONFLICT'));
  const events=await (await f.call('/api/planning/items/'+p.stable_ids.visit.item+'/events')).json();
  assert.equal(events.events[0].action,'model3_apply');
  const exported=await (await f.call('/api/export')).json();
  assert.equal(exported.planning_v3.schema_version,3);
  assert.equal(exported.planning.items[0].places[0].id,p.stable_ids.place.link);
  assert.ok(!JSON.stringify(s).includes('token_hash'));
  run(f.db,"UPDATE users SET disabled=1 WHERE id='editor'");
  assert.throws(()=>f.apply(p,'once'),code('PLANNING_ACCESS_DENIED'));
});

test('link edits retain IDs and archive in place; place deletion retains labels and invalidates preview',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  const created=f.ready(timedVisit());f.apply(created);
  const linkId=created.stable_ids.place.link,pid=created.stable_ids.visit.placement;
  const p=f.ready([{key:'change',type:'link_place',id:linkId,placement_id:pid,expected_version:1,data:{label_snapshot:'Updated label'}}]);
  f.apply(p);assert.equal(row(f,'placement_places',linkId).version,2);
  assert.equal(row(f,'placements',pid).version,2);
  assert.equal(row(f,'items',created.stable_ids.visit.item).version,2);
  const removing=f.ready([{key:'remove',type:'unlink_place',id:linkId,expected_version:2}]);
  const deleted=await f.call('/api/places/taipei-101','DELETE',{version:one(f.db,"SELECT visibility_version FROM places WHERE id='taipei-101'").visibility_version});
  assert.equal(deleted.status,200);
  assert.equal(row(f,'placement_places',linkId).label_snapshot,'Updated label');
  assert.equal(row(f,'placement_places',linkId).place_id,null);
  assert.throws(()=>f.apply(removing),code('PREVIEW_STALE'));
  const revised=updateChangeset(f.db,f.users.editor,removing.id,{version:3,expected_version:removing.version,commands:[{key:'remove',type:'unlink_place',id:linkId,expected_version:row(f,'placement_places',linkId).version}]},now);
  const refreshed=previewChangeset(f.db,f.users.editor,removing.id,{version:revised.version},now);
  f.apply(refreshed);
  assert.equal(row(f,'placement_places',linkId).archived_at,now);
  assert.equal(row(f,'placements',pid).location_state,'unspecified');
  assert.equal(one(f.db,'SELECT count(*) n FROM planning_placement_places').n,1);
});

test('snapshot detects new neighbours, coordinate and timezone changes, and expiry',async t=>{
  for(const mutation of ['neighbour','coordinates','timezone','expiry']){
    await t.test(mutation,async t=>{
      const f=await fixture();t.after(()=>f.db.close());
      const p=f.ready([newVisit('Pending')]);
      if(mutation==='neighbour')f.apply(f.ready([newVisit('Neighbour')]));
      if(mutation==='coordinates')run(f.db,"UPDATE places SET lat=lat+0.001 WHERE id='taipei-101'");
      if(mutation==='timezone')run(f.db,'UPDATE trips SET timezone_revision=timezone_revision+1 WHERE id=?',TRIP);
      assert.throws(()=>f.apply(p,'stale',f.users.editor,mutation==='expiry'?now+15*60000:now),code('PREVIEW_STALE'));
      assert.equal(getChangeset(f.db,f.users.editor,p.id).commands[0].data.title,'Pending');
      assert.equal(one(f.db,'SELECT count(*) n FROM planning_items WHERE title=?','Pending').n,0);
    });
  }
});

test('mid-persist SQL failure rolls back rows, versions, reminders, history and receipt; same package can retry',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  const p=f.ready(timedVisit()),before=fingerprint(readSources(f.db));
  run(f.db,"CREATE TRIGGER injected_failure BEFORE INSERT ON planning_placement_places BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  assert.throws(()=>f.apply(p,'retry'),/injected failure/);
  assert.equal(fingerprint(readSources(f.db)),before);
  assert.equal(one(f.db,'SELECT count(*) n FROM planning_operations').n,0);
  assert.equal(one(f.db,"SELECT count(*) n FROM planning_events WHERE action='model3_apply'").n,0);
  assert.equal(getChangeset(f.db,f.users.editor,p.id).status,'ready');
  run(f.db,'DROP TRIGGER injected_failure');f.apply(p,'retry');
  assert.deepEqual(all(f.db,'PRAGMA foreign_key_check'),[]);
  const placement=readSources(f.db).sources.placements[0];
  run(f.db,"INSERT INTO trips(id,name,timezone) VALUES('other-trip','Other','UTC')");
  assert.throws(()=>insertRow(f.db,'planning_placements',{...placement,id:'foreign',trip_id:'other-trip',archived_at:now}),/FOREIGN KEY/);
});

test('old HTTP, MCP and CLI writers cannot bypass model3; safe notes use common history and preserve links',async t=>{
  const f=await fixture({upgrade:false});t.after(()=>f.db.close());
  const visit=await f.legacy({kind:'visit',title:'Pinned',date_start:'2035-01-04',fixed_external:true,places:[{place_id:'taipei-101'}]},'pinned');
  upgradePlanningModel(f.db,f.users.editor,now);
  for(const [method,data] of [['PUT',{version:visit.version,date_start:'2035-01-05'}],['DELETE',{version:visit.version}]]){
    const response=await f.call('/api/planning/items/pinned',method,data);
    assert.equal(response.status,409);assert.equal((await response.json()).details.code,'MODEL3_REQUIRED');
  }
  const before=fingerprint(readSources(f.db));
  assert.throws(()=>transaction(f.db,()=>applyOperations(f.db,f.users.editor,{ids:{},operations:[
    {kind:'plan.update',id:'pinned',version:visit.version,data:{note:'Must roll back'}},
    {kind:'plan.update',id:'pinned',version:visit.version+1,data:{date_start:'2035-01-06'}},
  ]})),code('MODEL3_REQUIRED'));
  assert.equal(fingerprint(readSources(f.db)),before);
  await assert.rejects(importPlanning(f.db,{namespace:'old',items:[]},'editor'),code('MODEL3_IMPORT_REQUIRED'));
  const links=all(f.db,'SELECT * FROM planning_placement_places');
  const response=await f.call('/api/planning/items/pinned','PUT',{version:visit.version,note:'Saved note'});
  assert.equal(response.status,200);
  assert.deepEqual(all(f.db,'SELECT * FROM planning_placement_places'),links);
  assert.equal(one(f.db,'SELECT count(*) n FROM planning_operations').n,1);
  assert.equal(one(f.db,'SELECT date_start FROM planning_items WHERE id=?','pinned').date_start,'2035-01-04');
  const placement=readSources(f.db).sources.placements[0];
  const draft=createChangeset(f.db,f.users.editor,{version:3,commands:[{key:'move',type:'upsert_placement',id:placement.id,expected_version:placement.version,data:{date_start:'2035-01-05'}}]},now);
  const blocked=previewChangeset(f.db,f.users.editor,draft.id,{version:draft.version},now);
  assert.equal(blocked.preview.can_apply,false);
  assert.throws(()=>f.apply(blocked),code('SCHEDULE_BLOCKED'));
});

test('closed schemas reject unsafe/unsupported commands, prototype keys, invalid time and cross-trip places',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  for(const commands of [
    [{...newVisit(),key:'__proto__'}],
    [{...newVisit(),data:{...newVisit().data,trip_id:'other'}}],
    [{key:'approve',type:'approve_placement',id:'p'}],
  ])assert.throws(()=>createChangeset(f.db,f.users.editor,{version:3,commands},now));
  assert.equal(Object.prototype.item,undefined);
  for(const patch of [
    {starts_at:'2035-01-04T24:00:00Z'},
    {ends_at:'2035-01-04T08:00:00.000Z'},
    {intended_duration_minutes:30},
    {date_start:'2035-01-05'},
    {start_timezone:'No/Such_Zone'},
  ]){
    const commands=timedVisit();Object.assign(commands[0].data,patch);
    const d=createChangeset(f.db,f.users.editor,{version:3,commands},now);
    assert.throws(()=>previewChangeset(f.db,f.users.editor,d.id,{version:d.version},now));
  }
  run(f.db,"INSERT INTO trips(id,name,timezone) VALUES('foreign-trip','Other','UTC')");
  insertRow(f.db,'places',{...one(f.db,"SELECT * FROM places WHERE id='taipei-101'"),id:'foreign-place',trip_id:'foreign-trip'});
  const commands=timedVisit();commands[1].data.place_id='foreign-place';
  const d=createChangeset(f.db,f.users.editor,{version:3,commands},now);
  assert.throws(()=>previewChangeset(f.db,f.users.editor,d.id,{version:d.version},now),code('PLACE_UNAVAILABLE'));
  assert.equal(one(f.db,'SELECT count(*) n FROM planning_items').n,0);
});

test('editing draft keeps allocated IDs, invalidates preview and enforces draft versions',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  const p=f.ready([newVisit()]);
  const changed=updateChangeset(f.db,f.users.editor,p.id,{version:3,expected_version:p.version,commands:[newVisit('Renamed')]},now);
  assert.deepEqual(changed.stable_ids,p.stable_ids);
  assert.equal(changed.status,'draft');assert.equal(changed.preview,null);
  assert.throws(()=>f.apply(p),code('CHANGESET_VERSION_CONFLICT'));
  const ready=previewChangeset(f.db,f.users.editor,p.id,{version:changed.version},now);f.apply(ready);
  assert.equal(one(f.db,'SELECT title FROM planning_items').title,'Renamed');
  assert.equal(one(f.db,'SELECT id FROM planning_items').id,p.stable_ids.visit.item);
});

test('placeholders do not appear as confirmed stays in legacy views or map',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  const p=f.ready([
    {key:'hotel',type:'create_item',data:{kind:'stay',title:'Where to sleep'}},
    {key:'night',type:'upsert_placement',id:{command:'hotel',entity:'placement'},expected_version:1,data:{precision:'day',date_start:'2035-01-04',date_end:'2035-01-05',start_timezone:'Asia/Taipei',end_timezone:'Asia/Taipei'}},
    {key:'lodging',type:'link_place',placement_id:{command:'hotel',entity:'placement'},expected_version:0,data:{place_id:'taipei-101',role:'lodging'}},
  ]);f.apply(p);
  const old=await (await f.call('/api/planning?model=2')).json();
  assert.equal(old.items.length,0);assert.equal(old.compatibility.structural_writes,false);
  const map=await (await f.call('/api/data')).json();
  assert.equal(map.places.find(p=>p.id==='taipei-101').has_stay,false);
  assert.equal(readModel3(f.db,f.users.editor).sources.placements.length,1);
  const reference=f.ready([newVisit(),{key:'info',type:'link_place',placement_id:{command:'visit',entity:'placement'},expected_version:0,data:{place_id:'taipei-101',role:'reference'}}]);
  f.apply(reference);
  assert.equal(row(f,'placements',reference.stable_ids.visit.placement).location_state,'unspecified');
  const compatible=await (await f.call('/api/planning?model=2')).json();
  assert.equal(compatible.items.find(i=>i.id===reference.stable_ids.visit.item).places.length,0);
});

test('a move recalculates personal reminders once, retains sent generation and previews only own details',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  const p=f.ready(timedVisit());f.apply(p);
  const item=p.stable_ids.visit.item,pid=p.stable_ids.visit.placement;
  for(const id of ['editor','other','viewer'])
    run(f.db,'INSERT INTO planning_reminders(id,user_id,item_id,enabled,mode,offset_minutes,fires_at,generation,sent_generation,updated_at) VALUES(?,?,?,1,\'offset\',10,?,4,?,1)',id+'-rule',id,item,Date.parse('2035-01-04T07:50:00Z'),id==='viewer'?4:null);
  const commands=[{key:'move',type:'upsert_placement',id:pid,expected_version:1,data:{starts_at:'2035-01-04T09:00:00.000Z',ends_at:'2035-01-04T10:00:00.000Z'}}];
  const preview=f.ready(commands);
  assert.equal(preview.preview.reminder_impact.others_count,1);
  assert.deepEqual(preview.preview.reminder_impact.mine.map(x=>x.id),['editor-rule']);
  assert.ok(!JSON.stringify(preview.preview).includes('other-rule'));
  const beforeRules=all(f.db,'SELECT * FROM planning_reminders ORDER BY id'),beforeSources=fingerprint(readSources(f.db));
  run(f.db,"CREATE TRIGGER fail_receipt BEFORE INSERT ON planning_operations BEGIN SELECT RAISE(ABORT,'receipt failure'); END");
  assert.throws(()=>f.apply(preview,'move'),/receipt failure/);
  assert.deepEqual(all(f.db,'SELECT * FROM planning_reminders ORDER BY id'),beforeRules);
  assert.equal(fingerprint(readSources(f.db)),beforeSources);
  run(f.db,'DROP TRIGGER fail_receipt');
  f.apply(preview,'move');f.apply(preview,'move');
  assert.equal(one(f.db,"SELECT generation FROM planning_reminders WHERE id='editor-rule'").generation,5);
  assert.equal(one(f.db,"SELECT fires_at FROM planning_reminders WHERE id='other-rule'").fires_at,Date.parse('2035-01-04T08:50:00Z'));
  assert.equal(one(f.db,"SELECT generation FROM planning_reminders WHERE id='viewer-rule'").generation,4);
  const next=f.ready([{...commands[0],expected_version:2,data:{starts_at:'2035-01-04T10:00:00.000Z',ends_at:'2035-01-04T11:00:00.000Z'}}]);
  run(f.db,"UPDATE planning_reminders SET offset_minutes=30,version=version+1 WHERE id='editor-rule'");
  assert.throws(()=>f.apply(next),code('PREVIEW_STALE'));
});

test('HTTP changeset workflow routes create/edit/preview/apply and preserves idempotency',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  assert.equal((await f.call('/api/planning?model=4')).status,400);
  let response=await f.call('/api/planning/changesets','POST',{version:3,commands:[{...newVisit(),id:'route_custom'}]});
  assert.equal(response.status,201);const draft=await response.json();
  response=await f.call('/api/planning/changesets/'+draft.id,'PUT',{version:3,expected_version:draft.version,commands:[{...newVisit('Edited'),id:'route_custom'}]});
  assert.equal(response.status,200);const edited=await response.json();
  response=await f.call('/api/planning/changesets/'+draft.id+'/preview','POST',{version:edited.version});
  assert.equal(response.status,200);const preview=await response.json();
  const payload={version:preview.version,fingerprint:preview.preview.fingerprint,idempotency_key:'http-once'};
  response=await f.call('/api/planning/changesets/'+draft.id+'/apply','POST',payload);
  assert.equal(response.status,200);const receipt=await response.json();
  assert.deepEqual(await (await f.call('/api/planning/changesets/'+draft.id+'/apply','POST',payload)).json(),receipt);
  assert.equal((await f.call('/api/planning/items/route_custom/events')).status,200);
  const current=one(f.db,"SELECT * FROM planning_items WHERE id='route_custom'");
  response=await f.call('/api/planning/commands','POST',{version:3,idempotency_key:'text-http',commands:[{key:'text',type:'edit_item',id:current.id,expected_version:current.version,data:{note:'Safe edit'}}]});
  assert.equal(response.status,200);
  assert.equal(one(f.db,"SELECT note FROM planning_items WHERE id='route_custom'").note,'Safe edit');
});

test('new command path retains the existing trip record limit without partial creation',async t=>{
  const f=await fixture();t.after(()=>f.db.close());
  const scope=one(f.db,'SELECT id FROM planning_scopes').id;
  run(f.db,"WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM n WHERE value<1000) INSERT INTO planning_items(id,trip_id,kind,title,activation_scope_id,task_activation,created_by,updated_by,created_at,updated_at) SELECT 'task-'||value,?,'task','Fixture',?,'independent','editor','editor',1,1 FROM n",TRIP,scope);
  const before=fingerprint(readSources(f.db));
  assert.throws(()=>f.ready([newVisit()]),code('ITEM_LIMIT'));
  assert.equal(fingerprint(readSources(f.db)),before);
  assert.equal(one(f.db,'SELECT count(*) n FROM planning_operations').n,0);
});
