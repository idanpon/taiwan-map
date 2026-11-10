import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../server/database.mjs';
import {handle,passwordHash,sha} from '../src/core.mjs';
import {dayInZone,onDay,urgency,zonedInstant,itemDates,monthDays,monday} from '../public/planning-model.js';
import {readFileSync} from 'node:fs';
import {planItemMove,dateSnapshot} from '../public/planning-pilot-model.js';
async function fixture(){
 const DB=openDatabase();migrate(DB,'drizzle');const env={DB,APP_ORIGIN:'https://api.example',AUTH_MODE:'bearer',APP_PASSWORD_HASH:await passwordHash('planning-fixture')};
 const call=(path,method='GET',data,role='editor')=>handle(new Request(env.APP_ORIGIN+path,{method,headers:{Origin:env.APP_ORIGIN,...(role?{Authorization:'Bearer '+tokens[role]}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
 const tokens={};const login=await handle(new Request(env.APP_ORIGIN+'/api/login',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({password:'planning-fixture'})}),env);tokens.admin=(await login.json()).token;
 DB.sqlite.exec("INSERT INTO app_meta VALUES('accounts_v1','shared')");
 for(const [role,n] of [['editor','1'],['viewer','2']]){tokens[role]=n.repeat(64);DB.sqlite.prepare('INSERT INTO users(id,display_name,created_at) VALUES(?,?,?)').run(role,role,1);DB.sqlite.prepare('INSERT INTO memberships VALUES(?,?,?)').run('taiwan-2026',role,role);DB.sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await sha(tokens[role]),role,Date.now()+1000000)}
 async function create(value){const r=await call('/api/planning/items','POST',{kind:'task',title:'Task',...value});assert.equal(r.status,201,JSON.stringify(await r.clone().json()));return (await r.json()).item}
 async function preview(item,option,extra={}){const r=await call('/api/planning/items/'+item.id+'/preview','POST',{option_id:option,...extra});assert.equal(r.status,200,JSON.stringify(await r.clone().json()));return r.json()}
 async function resolve(p){return call('/api/planning/items/'+p.item_id+'/resolve','POST',p)}
 const get=async()=> (await call('/api/planning')).json();
 const place=()=>DB.sqlite.prepare("SELECT p.hidden,p.visibility_version,s.status_id,s.note,s.version FROM places p LEFT JOIN user_place_states s ON s.place_id=p.id AND s.user_id='trip-shared' WHERE p.id='taipei-101'").get();
 return {DB,call,create,preview,resolve,get,place};
}
const link=(option_id,extra={})=>({place_id:'taipei-101',option_id,affects_visit:true,unselected_action:'hide',...extra});
test('pilot date moves preserve data, enforce roles and reject stale item or timezone undo',async()=>{
 const f=await fixture();try{
  const original=await f.create({title:'Move me',note:'Keep this note',description:'Prepared text',assignee_id:'editor',date_start:'2026-12-29',date_end:'2026-12-31',places:[{place_id:'taipei-101'}],source_urls:['https://example.com']});
  const plan=(await f.get()).timezone_plan,patch=planItemMove(original,'2027-01-03',plan,'2026-12-30').patch;
  const payload={...patch,version:original.version,timezone_revision:plan.revision};
  assert.equal((await f.call('/api/planning/items/'+original.id,'PUT',payload,'viewer')).status,403);
  const movedResponse=await f.call('/api/planning/items/'+original.id,'PUT',payload);assert.equal(movedResponse.status,200);const moved=(await movedResponse.json()).item;
  assert.equal(moved.date_start,'2027-01-02');assert.equal(moved.date_end,'2027-01-04');
  for(const key of ['note','description','assignee_id','state','source_urls','dependencies'])assert.deepEqual(moved[key],original[key]);
  assert.equal(moved.places[0].place_id,original.places[0].place_id);
  f.DB.sqlite.prepare('UPDATE trips SET timezone_revision=timezone_revision+1').run();
  assert.equal((await f.call('/api/planning/items/'+original.id,'PUT',{...dateSnapshot(original),version:moved.version,timezone_revision:plan.revision})).status,409);
  const newer=await f.call('/api/planning/items/'+original.id,'PUT',{version:moved.version,note:'Another participant'});assert.equal(newer.status,200);
  assert.equal((await f.call('/api/planning/items/'+original.id,'PUT',{...dateSnapshot(original),version:moved.version,timezone_revision:plan.revision+1})).status,409);
  const saved=(await f.get()).items.find(item=>item.id===original.id);assert.equal(saved.note,'Another participant');assert.equal(saved.date_start,moved.date_start);
  const undo=await f.call('/api/planning/items/'+original.id,'PUT',{...dateSnapshot(original),version:saved.version,timezone_revision:plan.revision+1});assert.equal(undo.status,200);assert.equal((await undo.json()).item.date_start,original.date_start);
 }finally{f.DB.close()}
});
test('failed calendar batch rolls back records, links, place states, history and import ledger',async()=>{
 const f=await fixture();
 try{
  const tables=['planning_items','planning_options','planning_item_places','planning_dependencies','planning_events','user_place_states','state_events','app_meta'];
  const snapshot=()=>Object.fromEntries(tables.map(table=>[table,f.DB.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
  const before=snapshot();
  const {importPlanning}=await import('../server/import-planning.mjs');
  await assert.rejects(importPlanning(f.DB,{namespace:'atomic-batch',items:[
   {key:'valid',kind:'decision',title:'Valid choice',options:[{id:'atomic-yes',label:'Yes'}],places:[link('atomic-yes')]},
   {key:'invalid',kind:'task',title:'Invalid',date_start:'2035-02-30',dependencies:['valid']}
  ]},'editor'));
  assert.deepEqual(snapshot(),before);
  assert.deepEqual(f.DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{f.DB.close()}
});
test('exact calendar times reject rollover hours instead of silently changing the day',async()=>{
 const f=await fixture();
 try{
  for(const starts_at of ['2035-12-29T24:00:00Z','2035-12-29T25:01:00Z','2035-12-29T10:60:00Z']){
   assert.equal((await f.call('/api/planning/items','POST',{kind:'task',title:'Bad time',starts_at})).status,400,starts_at);
  }
  assert.equal((await f.get()).items.length,0);
 }finally{f.DB.close()}
});
test('calendar shares roles, dates and data; patching a field preserves note, sources and links',async()=>{const f=await fixture();try{
 assert.equal((await f.call('/api/planning','GET',undefined,'')).status,401);
 assert.equal((await f.call('/api/planning/items','POST',{kind:'task',title:'No'},'viewer')).status,403);
 assert.equal((await f.call('/api/planning','GET',undefined,'viewer')).status,200);
 const i=await f.create({title:'Book',description:'Prepared',note:'Private trip note',date_start:'2026-11-01',date_end:'2026-11-07',fixed_external:true,source_urls:['https://example.com'],places:[{place_id:'taipei-101'}]});
 const r=await f.call('/api/planning/items/'+i.id,'PUT',{version:i.version,title:'Updated'});assert.equal(r.status,200);const saved=(await r.json()).item;
 assert.equal(saved.note,i.note);assert.equal(saved.description,i.description);assert.deepEqual(saved.source_urls,i.source_urls);assert.equal(saved.places[0].place_id,'taipei-101');
 assert.equal((await f.call('/api/planning/items/'+i.id,'PUT',{version:1,note:'stale'})).status,409);
 assert.equal((await f.get()).trip.departure_date,'2026-12-28');
 const trip=(await f.get()).trip;assert.equal((await f.call('/api/planning/trip','PUT',{version:trip.version,departure_date:'2026-12-30',start_date:'2026-12-31',end_date:'2027-01-11'})).status,200);
 assert.equal((await f.get()).items[0].date_start,'2026-11-01');
 assert.ok((await(await f.call('/api/export')).json()).planning.items.some(x=>x.id===i.id));
}finally{f.DB.close()}});
test('dependencies are soft, cycle-free, and completion can be explicitly acknowledged',async()=>{const f=await fixture();try{
 const a=await f.create({title:'A'}),b=await f.create({title:'B',dependencies:[a.id]});
 assert.equal((await f.call('/api/planning/items/'+a.id,'PUT',{version:a.version,dependencies:[b.id]})).status,400);
 const warning=await f.call('/api/planning/items/'+b.id,'PUT',{version:b.version,state:'done'});assert.equal(warning.status,409);assert.equal((await warning.json()).details.code,'dependencies_open');
 assert.equal((await f.call('/api/planning/items/'+b.id,'PUT',{version:b.version,state:'done',ack_dependencies:true})).status,200);
 assert.equal((await f.get()).items.find(i=>i.id===a.id).state,'open');
}finally{f.DB.close()}});
test('overlapping decisions hold question marks; ordinary tasks do not; note-only map save is allowed',async()=>{const f=await fixture();try{
 await f.call('/api/places/taipei-101/state','PUT',{version:0,status_id:'maybe',note:'Keep me'});
 const a=await f.create({kind:'decision',title:'A',options:[{id:'a1',label:'Yes'},{id:'a2',label:'No'}],places:[link('a1')]}),b=await f.create({kind:'decision',title:'B',options:[{id:'b1',label:'Yes'},{id:'b2',label:'No'}],places:[link('b1')]});
 await f.create({title:'Book later',places:[{place_id:'taipei-101'}]});
 const blocked=await f.call('/api/places/taipei-101/state','PUT',{version:1,status_id:'want',note:'Keep me'});assert.equal(blocked.status,409);assert.equal((await blocked.json()).details.decisions.length,2);
 assert.equal((await f.call('/api/places/taipei-101/state','PUT',{version:1,status_id:'maybe',note:'Still editable'})).status,200);
 const pa=await f.preview(a,'a1');assert.ok(pa.warnings.some(w=>w.includes('B')));assert.equal(pa.effects[0].after.status_id,'maybe');assert.equal((await f.resolve(pa)).status,200);assert.equal(f.place().status_id,'maybe');
 const pb=await f.preview(b,'b1');assert.equal(pb.effects[0].after.status_id,'want');assert.equal((await f.resolve(pb)).status,200);assert.equal(f.place().status_id,'want');assert.equal(f.place().note,'Still editable');
 assert.equal((await f.resolve(pb)).status,409);assert.equal(f.place().version,3);
}finally{f.DB.close()}});
test('conflicting resolved alternatives preserve status/visibility and list cross-links',async()=>{const f=await fixture();try{
 const a=await f.create({kind:'decision',title:'A',options:[{id:'a1',label:'Yes'},{id:'a2',label:'No'}],places:[link('a1')]}),b=await f.create({kind:'decision',title:'B',options:[{id:'b1',label:'Yes'},{id:'b2',label:'No'}],places:[link('b1')]});
 await f.resolve(await f.preview(a,'a1'));const p=await f.preview(b,'b2');assert.ok(p.warnings.some(w=>w.includes('противоречат')));assert.equal(p.effects[0].after.hidden,0);assert.ok(p.related[0].items.some(i=>i.id===a.id));
}finally{f.DB.close()}});
test('decision preview is read-only, rejects deletion and stale snapshots; atomic application preserves notes',async()=>{const f=await fixture();try{
 const i=await f.create({kind:'decision',title:'Choice',options:[{id:'yes',label:'Yes'},{id:'no',label:'No'}],places:[link('yes')]});
 const p=await f.preview(i,'no');assert.equal(f.place().hidden,0);
 assert.equal((await f.call('/api/planning/items/'+i.id+'/preview','POST',{option_id:'no',alternatives:{'taipei-101':'delete'}})).status,400);
 await f.call('/api/places/taipei-101/visibility','PUT',{version:1,hidden:false});assert.equal((await f.resolve(p)).status,409);assert.equal((await f.get()).items[0].state,'open');
 const latest=await f.preview(i,'no');assert.equal((await f.resolve(latest)).status,200);assert.equal(f.place().hidden,1);
 const reopening=await f.preview({...i},null,{mode:'reopen'});assert.equal(reopening.effects[0].after.hidden,0);assert.equal((await f.resolve(reopening)).status,200);assert.equal(f.place().hidden,0);
}finally{f.DB.close()}});
test('reopening preserves subsequent manual visibility changes and never restores deleted places',async()=>{const f=await fixture();try{
 const i=await f.create({kind:'decision',title:'Choice',options:[{id:'yes',label:'Yes'},{id:'no',label:'No'}],places:[link('yes')]});
 await f.resolve(await f.preview(i,'no'));await f.call('/api/places/taipei-101/visibility','PUT',{version:2,hidden:true});
 const p=await f.preview(i,null,{mode:'reopen'});assert.equal(p.effects[0].after.hidden,1);assert.ok(p.warnings.some(w=>w.includes('позднее')));
 assert.equal((await f.call('/api/places/taipei-101','DELETE',{version:3})).status,200);
 const deleted=await f.preview(i,null,{mode:'reopen'});assert.equal(deleted.effects.length,0);assert.ok(deleted.warnings.some(w=>w.includes('удалено')));await f.resolve(deleted);assert.equal(f.place(),undefined);assert.equal((await f.get()).items[0].places[0].deleted,true);assert.deepEqual(f.DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
}finally{f.DB.close()}});
test('bulk deletion confirms the exact hidden set and retains calendar tasks with deleted captions',async()=>{const f=await fixture();try{
 const i=await f.create({title:'Keep task',places:[{place_id:'taipei-101'}]});await f.call('/api/places/taipei-101/visibility','PUT',{version:1,hidden:true});
 const payload={places:[{id:'taipei-101',version:2}]};assert.equal((await f.call('/api/places/hidden/delete-all','POST',payload,'viewer')).status,403);
 await f.call('/api/places/huashan/visibility','PUT',{version:1,hidden:true});assert.equal((await f.call('/api/places/hidden/delete-all','POST',payload)).status,409);assert.equal(f.place().hidden,1);
 payload.places.push({id:'huashan',version:2});const r=await f.call('/api/places/hidden/delete-all','POST',payload);assert.equal(r.status,200);assert.equal((await r.json()).count,2);
 const saved=(await f.get()).items.find(x=>x.id===i.id);assert.equal(saved.title,'Keep task');assert.equal(saved.places[0].place_name,'Taipei 101');assert.equal(saved.places[0].place_id,null);assert.equal(f.place(),undefined);
}finally{f.DB.close()}});
test('decision transaction rolls back every effect and journal entry on write failure',async()=>{const f=await fixture();try{
 const i=await f.create({kind:'decision',title:'Choice',options:[{id:'yes',label:'Yes'}],places:[link('yes')]});const p=await f.preview(i,'yes');
 f.DB.sqlite.exec("CREATE TRIGGER fail_resolution BEFORE INSERT ON planning_events WHEN NEW.action='resolve' BEGIN SELECT RAISE(ABORT,'test rollback'); END");
 assert.equal((await f.resolve(p)).status,500);assert.equal(f.place().status_id,'maybe');assert.equal((await f.get()).items[0].state,'open');assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM state_events').get().n,1);
}finally{f.DB.close()}});
test('dates validate real days, exact instants, visit dates and immutable state boundaries',async()=>{const f=await fixture();try{
 for(const value of [{date_start:'2026-02-30'},{date_start:'2026-11-10',date_end:'2026-11-01'},{event_timezone:'No/Zone'},{kind:'visit'},{source_urls:['javascript:alert(1)']}])assert.equal((await f.call('/api/planning/items','POST',{kind:'task',title:'Bad',...value})).status,400);
 const visit=await f.create({kind:'visit',starts_at:'2026-12-28T17:00:00Z',event_timezone:'Asia/Taipei'});assert.equal(visit.date_start,'2026-12-29');assert.equal(itemDates(visit,'America/Los_Angeles')[0],'2026-12-29');
 for(const dates of [{ends_at:'2026-11-05T02:00:00Z'},{date_end:'2026-11-05',starts_at:'2026-11-04T02:00:00Z'}])assert.equal((await f.call('/api/planning/items','POST',{kind:'task',title:'Incomplete period',...dates})).status,400);
 const source=await f.create({kind:'task',starts_at:'2026-11-05T02:00:00Z',event_timezone:'Asia/Taipei',fixed_external:true});assert.equal(itemDates(source,'America/Los_Angeles')[0],'2026-11-04');
}finally{f.DB.close()}});
test('calendar computation handles Monday boundaries, inclusive periods, urgency and Taiwan/device dates',()=>{
 assert.equal(monday('2026-11-01'),'2026-10-26');assert.equal(monthDays('2026-11-01').length,42);
 const period={kind:'task',state:'open',date_start:'2026-10-20',date_end:'2026-10-22'};
 assert.equal(onDay(period,'2026-10-22','Europe/Moscow'),true);assert.equal(onDay(period,'2026-10-23','Europe/Moscow'),false);
 const now=new Date('2026-10-21T12:00:00Z'),opts={now,zone:'Europe/Moscow'};
 assert.deepEqual(urgency(period,opts),{kind:'current',label:'Период идёт'});
 assert.equal(urgency({...period,date_start:'2026-10-21',date_end:null},opts).kind,'current');
 assert.equal(urgency({...period,date_end:'2026-10-20'},opts).kind,'overdue');assert.equal(urgency({...period,state:'done'},opts).kind,'quiet');
 assert.equal(dayInZone('2026-10-21T22:00:00Z','Asia/Taipei'),'2026-10-22');
 assert.equal(zonedInstant('2026-11-05','10:00','Asia/Taipei'),'2026-11-05T02:00:00.000Z');
 assert.throws(()=>zonedInstant('2026-03-08','02:30','America/New_York'));assert.throws(()=>zonedInstant('2026-11-01','01:30','America/New_York'));
});
test('planning page keeps gated authentication and exposes the two approved views',async()=>{
 const {planningPage}=await import('../src/planning-ui.mjs');assert.ok(planningPage.includes('src="/planning.js"'));assert.ok(planningPage.includes('id="auth-content" hidden'));assert.ok(planningPage.includes('data-view="month"'));assert.ok(planningPage.includes('data-view="list"'));
 assert.ok(!planningPage.includes('data-view="day"'));assert.ok(!planningPage.includes('data-view="week"'));assert.ok(planningPage.includes('<h1>План поездки</h1>'));
 const source=readFileSync('public/planning.js','utf8');assert.ok(source.includes('renderPlanningPilot'));assert.ok(!source.includes('innerHTML=i.note'));
});

test('resolved decisions allow notes but require a new preview for structural changes',async()=>{const f=await fixture();try{
 const i=await f.create({kind:'decision',title:'Choice',options:[{id:'yes',label:'Yes'}],places:[link('yes')]});await f.resolve(await f.preview(i,'yes'));
 const r=await f.call('/api/planning/items/'+i.id,'PUT',{version:2,note:'A note after choosing'});assert.equal(r.status,200,JSON.stringify(await r.clone().json()));assert.equal((await r.json()).item.note,'A note after choosing');
 assert.equal((await f.call('/api/planning/items/'+i.id,'PUT',{version:3,state:'open'})).status,409);assert.equal(f.place().status_id,'want');
}finally{f.DB.close()}});
test('malformed relations fail without partial writes and the seed importer is idempotent',async()=>{const f=await fixture();try{
 for(const patch of [{assignee_id:{}},{places:[null]},{places:[{place_id:{}}]},{kind:'decision',options:[null]},{kind:'decision',options:[{id:123,label:'Bad'}]}])assert.equal((await f.call('/api/planning/items','POST',{kind:'task',title:'Malformed',...patch})).status,400);
 assert.equal((await f.get()).items.length,0);
 const {importPlanning}=await import('../server/import-planning.mjs');const manifest={namespace:'test-seed',items:[{key:'b',kind:'task',title:'B',dependencies:['a']},{key:'a',kind:'task',title:'A'}]};
 const first=await importPlanning(f.DB,manifest,'editor');assert.equal(first.created,2);
 const saved=(await f.get()).items.find(i=>i.title==='A');await f.call('/api/planning/items/'+saved.id,'PUT',{version:1,note:'Do not overwrite'});
 const repeated=await importPlanning(f.DB,manifest,'editor');assert.equal(repeated.created,0);assert.equal(repeated.skipped,2);assert.equal((await f.get()).items.find(i=>i.id===saved.id).note,'Do not overwrite');
 assert.equal((await f.get()).items.find(i=>i.title==='B').dependencies[0],saved.id);
 await assert.rejects(importPlanning(f.DB,{namespace:'cycle',items:[{key:'a',dependencies:['b']},{key:'b',dependencies:['a']}]},'editor'),/cycle/);
}finally{f.DB.close()}});

test('reopening an earlier overlapping decision restores the question even after another decision set want',async()=>{const f=await fixture();try{
 const a=await f.create({kind:'decision',title:'A',options:[{id:'a1',label:'Yes'}],places:[link('a1')]}),b=await f.create({kind:'decision',title:'B',options:[{id:'b1',label:'Yes'}],places:[link('b1')]});
 assert.equal(f.place().status_id,'maybe');await f.resolve(await f.preview(a,'a1'));await f.resolve(await f.preview(b,'b1'));assert.equal(f.place().status_id,'want');
 const p=await f.preview(a,null,{mode:'reopen'});assert.equal(p.effects[0].after.status_id,'maybe');assert.equal((await f.resolve(p)).status,200);assert.equal(f.place().status_id,'maybe');
}finally{f.DB.close()}});

test('optional calendar enrichment ignores old sessions and contains calendar fetch failures',async()=>{
 const {hydratePlanningLinks}=await import('../public/planning-links.js');let release,current={session:'A'},shown=0,errors=0;const original=current;
 const pending=hydratePlanningLinks({api:()=>new Promise(resolve=>release=resolve),current:original,getCurrent:()=>current,onReady:()=>shown++,onError:()=>errors++});
 current={session:'B'};release({items:[]});await pending;assert.equal(shown,0);assert.equal(errors,0);
 await hydratePlanningLinks({api:async()=>{throw new Error('provider unavailable')},current,getCurrent:()=>current,onReady:()=>shown++,onError:()=>errors++});assert.equal(errors,1);assert.equal(shown,0);
 await hydratePlanningLinks({api:async()=>({items:[]}),current,getCurrent:()=>current,onReady:()=>shown++,onError:()=>errors++});assert.equal(shown,1);
});

test('stay uses one linked place and preserves the shared booking workflow',async t=>{
 const f=await fixture();t.after(()=>f.DB.close());
 const booking=await f.create({title:'Подтвердить бронь',state:'done'});
 const beforePlace=f.place();
 const fields={kind:'stay',title:null,date_start:'2026-12-31',date_end:'2027-01-03',ends_at:'2027-01-03T03:00:00Z',
  places:[{role:'lodging',place_id:'taipei-101'}],note:'Keep booking details',source_urls:['https://example.test/confirmation'],dependencies:[booking.id]};
 const invalid=patch=>f.call('/api/planning/items','POST',{...fields,...patch});
 assert.equal((await invalid({places:[]})).status,400);
 assert.equal((await invalid({places:[{role:'lodging',place_name:'Text only'}]})).status,400);
 assert.equal((await invalid({date_start:fields.date_end})).status,400);
 assert.equal((await invalid({date_end:'2027-01-04'})).status,400);
 const stay=await f.create(fields),path='/api/planning/items/'+stay.id;
 assert.equal(stay.title,stay.places[0].place_name);
 assert.equal(stay.starts_at,null);
 assert.equal(stay.ends_at,'2027-01-03T03:00:00.000Z');
 assert.deepEqual(stay.dependencies,[booking.id]);
 assert.deepEqual(f.place(),beforePlace);
 const data=async(path='/api/data',role='viewer')=>(await f.call(path,'GET',undefined,role)).json();
 const accent=async()=> (await data()).places.find(p=>p.id==='taipei-101').has_stay;
 assert.equal(await accent(),true);
 assert.ok((await data('/api/public/data','')).places.every(p=>!Object.hasOwn(p,'has_stay')));
 assert.deepEqual((await f.get()).items.map(i=>i.id),[booking.id]);
 assert.ok((await data('/api/planning?model=2')).items.some(i=>i.id===stay.id));
 assert.ok((await data('/api/export')).planning.items.some(i=>i.id===stay.id));
 const cancel={version:stay.version,state:'cancelled'};
 assert.equal((await f.call(path,'PUT',cancel,'viewer')).status,403);
 const cancelled=(await (await f.call(path,'PUT',cancel)).json()).item;
 assert.equal(await accent(),false);
 assert.equal(cancelled.note,fields.note);
 assert.deepEqual(cancelled.source_urls,fields.source_urls);
 assert.equal((await f.call(path,'PUT',cancel)).status,409);
 const checkout=await f.create({title:'Уточнить выезд',dependencies:[stay.id]});
 const place= (await data()).places.find(p=>p.id==='taipei-101');
 assert.equal((await f.call('/api/places/taipei-101','DELETE',{version:place.visibility_version})).status,200);
 const edited=await f.call(path,'PUT',{version:cancelled.version,note:'Preserve after place deletion'});
 assert.equal(edited.status,200);
 const {item:orphan}=await edited.json();
 assert.deepEqual(orphan.places.map(p=>[p.role,p.place_name,p.deleted]),[['lodging',stay.title,true]]);
 assert.equal((await f.call(path,'DELETE',{version:orphan.version})).status,200);
 const after=(await f.get()).items.find(item=>item.id===checkout.id);
 assert.equal(after.version,checkout.version+1);
 assert.deepEqual(after.dependencies,[]);
});

test('transport stores endpoint zones and optional exact times, validates chronology and round-trips stops',async t=>{
 const f=await fixture();t.after(()=>f.DB.close());
 const fields={
  kind:'transport',title:'CZ8028',event_timezone:'Europe/Moscow',
  date_start:'2026-12-28',date_end:'2026-12-29',
  starts_at:'2026-12-28T11:50:00Z',ends_at:'2026-12-28T21:10:00Z',
  places:[{role:'departure',place_name:'Москва SVO'},{role:'arrival',place_name:'Гуанчжоу CAN'}],
  transport:{mode:'plane',arrival_timezone:'Asia/Shanghai',service_number:'CZ8028',
   departure_details:'Терминал C',arrival_details:'Терминал 2',stops:['Первая','Вторая']},
 };
 const check=patch=>f.call('/api/planning/items','POST',{...fields,...patch});
 for(const patch of [
  {date_end:'2026-12-28'},
  {ends_at:'2026-12-28T03:10:00Z',date_end:null},
  {transport:{...fields.transport,mode:'metro'}},
  {transport:{...fields.transport,arrival_timezone:'+08:00'}},
  {places:fields.places.slice(0,1)},
  {places:[...fields.places,fields.places[0]]},
  {starts_at:null,date_start:'2026-12-30'},
 ]) assert.equal((await check(patch)).status,400);
 const flight=await f.create(fields),path='/api/planning/items/'+flight.id;
 assert.deepEqual(flight.transport,fields.transport);
 assert.deepEqual(flight.places.map(p=>[p.role,p.place_name,p.place_id,p.deleted]),[
  ['arrival','Гуанчжоу CAN',null,false],['departure','Москва SVO',null,false]]);
 assert.deepEqual(itemDates(flight,'America/New_York'),['2026-12-28','2026-12-29']);
 assert.equal((await f.call(path,'PUT',{version:0,note:'Stale'})).status,409);
 const {item:partial}=await (await f.call(path,'PUT',{version:flight.version,starts_at:null})).json();
 assert.equal(partial.starts_at,null);assert.equal(partial.date_start,fields.date_start);
 assert.equal(partial.ends_at,flight.ends_at);
 const {item:dateOnly}=await (await f.call(path,'PUT',{version:partial.version,ends_at:null})).json();
 assert.equal(dateOnly.ends_at,null);assert.equal(dateOnly.date_end,fields.date_end);
 const dateLine=await f.create({...fields,event_timezone:'Asia/Tokyo',date_start:'2027-01-02',date_end:'2027-01-01',
  starts_at:'2027-01-01T15:20:00Z',ends_at:'2027-01-01T22:20:00Z',
  transport:{mode:'plane',arrival_timezone:'Pacific/Honolulu'}});
 assert.deepEqual(itemDates(dateLine,'Asia/Taipei'),['2027-01-01','2027-01-02']);
 assert.equal((await f.call(path,'DELETE',{version:dateOnly.version})).status,200);
 assert.equal((await f.call(path,'DELETE',{version:dateOnly.version})).status,404);
});
