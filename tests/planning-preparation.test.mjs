import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../server/database.mjs';
import { seed } from '../src/seed.mjs';
import { all, one, run } from '../src/sqlite.mjs';
import { TRIP, sha } from '../src/auth.mjs';
import { handle } from '../src/core.mjs';
import { upgradePlanningModel } from '../src/planning-upgrade.mjs';
import { readSources, fingerprint } from '../src/planning-domain-store.mjs';
import { readModel3, createChangeset, previewChangeset, applyChangeset } from '../src/planning-command-service.mjs';
import { bookingRegistry } from '../src/planning-bookings.mjs';
import { applicablePlanningIds } from '../src/planning-applicability.mjs';
import { createPushScheduler } from '../server/push-scheduler.mjs';
import { applyPlanningChange } from '../src/planning.mjs';
import { mkdtempSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backup } from 'node:sqlite';
import { handlePlaceLifecycle } from '../src/place-lifecycle.mjs';

const NOW=Date.parse('2030-01-01T00:00:00Z'),TZ='Asia/Taipei';
const code=expected=>e=>e.details?.code===expected;
const ref=(command,entity)=>({command,entity});
const link=(key,name,refs,data={})=>({key,type:'set_'+name,expected_version:0,...refs,data});
async function fixture(t,{upgrade=true}={}){
  const db=openDatabase();migrate(db,'drizzle');await seed(db);t.after(()=>db.close());
  run(db,"INSERT INTO app_meta(key,value) VALUES('accounts_v1','shared')");
  for(const [id,role] of [['editor','editor'],['viewer','viewer']]){run(db,'INSERT INTO users(id,display_name,created_at) VALUES(?,?,1)',id,id);run(db,'INSERT INTO memberships VALUES(?,?,?)',TRIP,id,role);}
  const user={id:'editor',role:'editor'},viewer={id:'viewer',role:'viewer'};
  if(upgrade)upgradePlanningModel(db,user,NOW);
  const sources=()=>readSources(db).sources,row=(collection,id)=>sources()[collection].find(x=>x.id===id);
  function preview(commands,now=NOW,actor=user){const draft=createChangeset(db,actor,{version:3,commands},now);return previewChangeset(db,actor,draft.id,{version:draft.version},now);}
  const apply=(p,now=NOW)=>applyChangeset(db,user,p.id,{version:p.version,fingerprint:p.preview.fingerprint,idempotency_key:'apply-'+p.id,acknowledgements:p.preview.allowed_acknowledgements},now);
  const write=(commands,now=NOW)=>{const p=preview(commands,now);apply(p,now);return p.preview.resolved_ids;};
  const change=(collection,id,type,extra)=>({key:'change',type,id,expected_version:row(collection,id).version,...extra});
  const model=(now=NOW)=>readModel3(db,user,now);
  const token='9'.repeat(64);run(db,'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',await sha(token),user.id,Date.now()+86400000);
  const call=async(path,auth=true)=>{const response=await handle(new Request('https://example.test'+path,{headers:auth?{Authorization:'Bearer '+token}:{}}),{DB:db,APP_ORIGIN:'https://example.test',AUTH_MODE:'bearer'});return {status:response.status,body:await response.json()};};
  return {db,user,viewer,sources,row,preview,apply,write,change,model,call};
}
function visitCommands({key='visit',kind='visit',date='2035-01-04',end='2035-01-07',units=1}={}){
  const needKind=kind==='stay'?'accommodation':kind==='transport'?'transport':'admission',role=kind==='stay'?'lodging':kind==='transport'?'departure':'visit';
  return [
    {key,type:'create_item',data:{kind,title:key,note:'Keep my note'}},
    {key:key+'slot',type:'upsert_placement',id:ref(key,'placement'),expected_version:1,data:kind==='stay'?{precision:'day',date_start:date,date_end:end,start_timezone:TZ,end_timezone:TZ}:{precision:'exact',starts_at:date+'T08:00:00.000Z',ends_at:date+'T09:00:00.000Z',start_timezone:TZ,end_timezone:TZ}},
    {key:key+'place',type:'link_place',placement_id:ref(key,'placement'),expected_version:0,data:{place_id:'taipei-101',role}},
    {key:key+'need',type:'create_need',data:{kind:needKind,label:'Requirement '+key,required_units:units,unit_type:kind==='stay'?'room':'person'}},
    link(key+'target','need_target',{need_id:ref(key+'need','need'),placement_id:ref(key,'placement')}),
    {key:key+'prep',type:'ensure_preparation',need_id:ref(key+'need','need'),expected_version:1,data:{title:'Book '+key}},
  ];
}
function ticketCommands(needId,{key='ticket',kind='admission',capacity=1,state='confirmed',date='2035-01-04',end='2035-01-07',place='taipei-101',data={}}={}){
  return [
    {key:key+'booking',type:'record_booking',data:{category:kind==='stay'?'lodging':kind==='transport'?'air':'activity',reference:'SAME-REFERENCE'}},
    {key,type:'add_service',booking_id:ref(key+'booking','booking'),data:{kind,state,title:key,validity:kind==='stay'?'date_range':kind==='transport'?'exact_interval':'exact_start',
      ...(kind==='stay'?{date_start:date,date_end:end,start_timezone:TZ,end_timezone:TZ}:{starts_at:date+'T08:00:00.000Z',start_timezone:TZ,...(kind==='transport'?{ends_at:date+'T09:00:00.000Z',end_timezone:TZ}:{})}),capacity_units:capacity,unit_type:kind==='stay'?'room':'person',...data}},
    link(key+'place','service_place',{service_id:ref(key,'service')},{place_id:place,role:kind==='stay'?'lodging':kind==='transport'?'departure':'visit',...(place===null?{label_snapshot:'Taipei 101'}:{})}),
    link(key+'allocation','need_service',{need_id:needId,service_id:ref(key,'service')}),
  ];
}

test('Taipei 101: preparation completion does not prove admission; supplier cancellation restores unmet need',async t=>{
  const f=await fixture(t),ids=f.write(visitCommands()),need=ids.visitneed.need,task=ids.visitprep.item;
  assert.equal(f.model().derived.placements[0].readiness,'needs_preparation');
  f.write([f.change('items',task,'set_task_state',{state:'done'})]);
  assert.equal(f.model().derived.needs[0].status,'missing');
  const ticket=f.write(ticketCommands(need));
  assert.equal(f.model().derived.placements[0].readiness,'ready');
  assert.equal(f.row('items',task).state,'done');
  assert.equal(f.model().derived.time_reasons[0].service_id,ticket.ticket.service);
  f.write([f.change('services',ticket.ticket.service,'set_service_state',{state:'cancelled',reason:'Supplier cancelled'})]);
  assert.equal(f.model().derived.needs[0].status,'missing');
  assert.equal(f.row('items',ids.visit.item).note,'Keep my note');
  assert.equal(f.row('items',task).state,'done');
  assert.equal(f.model().derived.time_reasons.length,0);
  assert.equal(bookingRegistry(f.db,f.viewer,ticket.ticketbooking.booking,{history:true}).events.length,2);
  const history=(await f.call('/api/planning/items/'+ids.visit.item+'/events')).body;
  assert(history.events.some(e=>e.payload?.commands?.some(c=>c.type==='set_service_state')));
  assert.equal((await f.call('/api/bookings')).status,200);
  assert.equal((await f.call('/api/bookings',false)).status,401);
  assert.equal((await f.call('/api/bookings/unknown')).status,404);
  assert.throws(()=>f.preview([{key:'b',type:'record_booking',data:{}}],NOW,f.viewer),code('PLANNING_ACCESS_DENIED'));
});

test('cancelled tasks preserve needs, explicit task results are distinct, ensure reuses only open producing tasks',async t=>{
  const f=await fixture(t),ids=f.write(visitCommands()),need=ids.visitneed.need,task=ids.visitprep.item;
  const ensure=()=>({key:'prep',type:'ensure_preparation',need_id:need,expected_version:f.row('needs',need).version,data:{title:'New'}});
  assert.equal(f.write([ensure()]).prep.item,task);
  f.write([f.change('items',task,'set_task_state',{state:'cancelled'})]);
  const next=f.write([ensure()]).prep.item;assert.notEqual(next,task);
  assert.equal(f.model().derived.needs[0].status,'missing');
  const n=f.write([{key:'n',type:'create_need',data:{kind:'task_result',label:'Confirm opening'}},link('target','need_target',{need_id:ref('n','need'),placement_id:ids.visit.placement}),
    {key:'prep',type:'ensure_preparation',need_id:ref('n','need'),expected_version:1,as_result:true,data:{}}]);
  f.write([f.change('items',n.prep.item,'set_task_state',{state:'done'})]);
  assert.equal(f.model().derived.needs.find(x=>x.id===n.n.need).status,'satisfied');
  assert.throws(()=>f.preview([{...ensure(),as_result:true}]),code('INVALID_TASK_RESULT'));
  const extra=f.write([{key:'extra',type:'create_item',data:{kind:'task',title:'Other'}},link('producer','need_task',{need_id:need,task_id:ref('extra','item')},{relation:'produce'})]);
  assert.throws(()=>f.preview([ensure()]),code('AMBIGUOUS_PREPARATION'));
  assert.equal(f.write([{...ensure(),task_id:extra.extra.item}]).prep.item,extra.extra.item);
});

test('explicit prerequisites block completion and reject cycles atomically',async t=>{
  const f=await fixture(t),ids=f.write([{key:'a',type:'create_item',data:{kind:'task',title:'Visa'}},{key:'b',type:'create_item',data:{kind:'task',title:'Buy'}},link('dep','prerequisite',{task_id:ref('b','item'),required_task_id:ref('a','item')})]);
  assert.throws(()=>f.preview([f.change('items',ids.b.item,'set_task_state',{state:'done'})]),code('TASK_PREREQUISITE_BLOCKED'));
  const before=fingerprint(f.sources());
  assert.throws(()=>f.preview([link('cycle','prerequisite',{task_id:ids.a.item,required_task_id:ids.b.item})]),code('TASK_DEPENDENCY_CYCLE'));
  assert.equal(fingerprint(f.sources()),before);
  f.write([f.change('items',ids.a.item,'set_task_state',{state:'done'}),{...f.change('items',ids.b.item,'set_task_state',{state:'done'}),key:'b'}]);
  f.write([f.change('items',ids.a.item,'set_task_state',{state:'open'})]);
  assert.equal(f.row('items',ids.b.item).state,'done');
  assert(f.model().derived.issues.some(x=>x.code==='COMPLETED_TASK_PREREQUISITE_CHANGED'));
});

test('two individual tickets cover a group; unknown quantity and reused single-use tickets never silently satisfy',async t=>{
  const f=await fixture(t),ids=f.write(visitCommands({units:2})),need=ids.visitneed.need;
  const first=f.write(ticketCommands(need));assert.equal(f.model().derived.needs[0].status,'partial');
  f.write(ticketCommands(need,{key:'second'}));assert.equal(f.model().derived.needs[0].status,'satisfied');
  const another=f.write(visitCommands({key:'another',date:'2035-01-05'}));
  f.write([link('reuse','need_service',{need_id:another.anotherneed.need,service_id:first.ticket.service})]);
  assert.equal(f.model().derived.needs.find(n=>n.id===another.anotherneed.need).status,'mismatch');
  f.write([f.change('services',first.ticket.service,'correct_service',{data:{validity:'date_range',starts_at:null,date_start:'2035-01-04',date_end:'2035-01-05'},reason:'Date-range ticket'})]);
  assert(f.model().derived.issues.some(i=>i.code==='SERVICE_OVERALLOCATED'));
  assert.notEqual(f.model().derived.needs.find(n=>n.id===need).status,'satisfied');
  assert.throws(()=>f.preview([link('badshare','need_service',{need_id:another.anotherneed.need,service_id:first.ticket.service},{use_mode:'shared'})]),code('DUPLICATE_LINK'));
  f.write([f.change('needs',need,'edit_need',{data:{required_units:null}})]);
  assert.notEqual(f.model().derived.needs.find(n=>n.id===need).status,'satisfied');
});

test('housing coverage is per night; split cancellation retains source, marks partial readiness and map facts',async t=>{
  const f=await fixture(t),ids=f.write(visitCommands({kind:'stay'})),need=ids.visitneed.need;
  assert.equal((await f.call('/api/data')).body.places.find(p=>p.id==='taipei-101').has_stay,false);
  const booked=f.write(ticketCommands(need,{kind:'stay',capacity:null}));
  assert.equal(f.model().derived.needs[0].status,'unknown');
  assert.equal((await f.call('/api/data')).body.places.find(p=>p.id==='taipei-101').has_stay,true);
  f.write([f.change('services',booked.ticket.service,'correct_service',{data:{capacity_units:1},reason:'Confirmed one room'})]);
  const parts=f.write([f.change('services',booked.ticket.service,'split_service',{mode:'nights',parts:[{date_start:'2035-01-04',date_end:'2035-01-06'},{date_start:'2035-01-06',date_end:'2035-01-07'}],reason:'Cancel last night separately'})]);
  assert.equal(f.model().derived.needs[0].status,'satisfied');
  assert.equal(f.row('services',booked.ticket.service).state,'superseded');
  f.write([f.change('services',parts.change.service_1,'set_service_state',{state:'cancelled',reason:'Night cancelled by hotel'})]);
  assert.equal(f.model().derived.needs[0].status,'partial');
  assert.deepEqual(f.model().derived.housing_coverage.map(c=>c.night),['2035-01-04','2035-01-05']);
  f.write([link('nohotel','need_exemption',{need_id:need,placement_id:ids.visit.placement},{date_start:'2035-01-06',date_end:'2035-01-07',reason:'Overnight train confirmed separately'})]);
  assert.equal(f.model().derived.needs[0].status,'satisfied');
  f.write([f.change('items',ids.visit.item,'archive_item')]);
  assert.equal(f.model().derived.needs[0].applicability,'dormant');
  const registry=bookingRegistry(f.db,f.user,booked.ticketbooking.booking).bookings[0];
  assert.equal(registry.needs_action,true);
  assert.deepEqual(registry.services.find(s=>s.id===parts.change.service_0).unused_nights,['2035-01-04','2035-01-05']);
  assert.equal((await f.call('/api/data')).body.places.find(p=>p.id==='taipei-101').has_stay,false);
});

test('free-text place labels require explicit verification and any changed endpoint invalidates it',async t=>{
  const f=await fixture(t),ids=f.write(visitCommands()),booked=f.write(ticketCommands(ids.visitneed.need,{place:null}));
  assert.equal(f.model().derived.needs[0].status,'unknown');
  const allocation=booked.ticketallocation.link;
  f.write([f.change('need_services',allocation,'set_need_service',{need_id:ids.visitneed.need,service_id:booked.ticket.service,data:{verify_place:true,context_note:'Checked on supplier website'}})]);
  assert.equal(f.model().derived.needs[0].status,'satisfied');
  f.write([f.change('service_places',booked.ticketplace.link,'set_service_place',{service_id:booked.ticket.service,data:{label_snapshot:'Changed entry gate'}})]);
  assert.equal(f.model().derived.needs[0].status,'unknown');
  const otherPlace=f.sources().places.find(p=>p.id!=='taipei-101').id;
  f.write([f.change('service_places',booked.ticketplace.link,'set_service_place',{service_id:booked.ticket.service,data:{place_id:otherPlace}}),
    {...f.change('need_services',allocation,'set_need_service',{need_id:ids.visitneed.need,service_id:booked.ticket.service,data:{verify_place:true,context_note:'Checked on supplier website'}}),key:'verify'}]);
  assert.equal(f.model().derived.needs[0].status,'mismatch');
});

test('holds expire in read projection and invalidate preview without a database write',async t=>{
  const f=await fixture(t),ids=f.write(visitCommands()),booked=f.write(ticketCommands(ids.visitneed.need,{state:'held',data:{hold_expires_at:NOW+60000}}));
  assert.equal(f.model().derived.needs[0].status,'unknown');assert.equal(f.model().next_evaluation_at,NOW+60000);
  const preview=f.preview([f.change('services',booked.ticket.service,'set_service_state',{state:'confirmed',reason:'Paid'})]);
  assert.equal(preview.expires_at,NOW+60000);
  const before=fingerprint(f.sources());
  assert.throws(()=>f.apply(preview,NOW+60000),code('PREVIEW_STALE'));
  assert.equal(f.model(NOW+60000).derived.services[0].effective_state,'expired');
  assert.equal(f.model(NOW+60000).derived.time_reasons.length,0);
  assert.equal(fingerprint(f.sources()),before);
});

test('replacement records facts and links, while exchange work remains explicitly open',async t=>{
  const f=await fixture(t),ids=f.write(visitCommands()),old=f.write(ticketCommands(ids.visitneed.need));
  const exchange=f.write([{key:'exchange',type:'create_item',data:{kind:'task',title:'Exchange ticket'}},link('action','service_task',{task_id:ref('exchange','item'),service_id:old.ticket.service},{action:'exchange'})]);
  const replacement=f.write(ticketCommands(ids.visitneed.need,{key:'new',data:{replaces_service_id:old.ticket.service}}));
  assert.equal(f.row('services',old.ticket.service).state,'confirmed');
  f.write([f.change('services',old.ticket.service,'replace_service',{replacement_id:replacement.new.service,reason:'Exchange confirmed by supplier'})]);
  assert.equal(f.row('services',old.ticket.service).state,'superseded');
  assert.equal(f.row('items',exchange.exchange.item).state,'open');
  assert.equal(f.model().derived.needs[0].status,'satisfied');
  f.write([f.change('items',ids.visit.item,'archive_item')]);
  assert(applicablePlanningIds(f.db).has(exchange.exchange.item));
  assert(!applicablePlanningIds(f.db).has(ids.visitprep.item));
  assert.throws(()=>f.preview([f.change('services',replacement.new.service,'replace_service',{replacement_id:old.ticket.service,reason:'Bad cycle'})]),code('INVALID_REPLACEMENT'));
});

test('relative targets use min anchors, preserve uncertainty, freeze completed work and recompute on reopening',async t=>{
  const f=await fixture(t),a=f.write(visitCommands()),task=a.visitprep.item;
  const d=f.write([link('deadline','deadline',{}, {task_id:task,kind:'target',mode:'relative',timezone:TZ}),link('rule','deadline_rule',{task_id:task,anchor_placement_id:a.visit.placement},{anchor:'start',offset_days:-2,rule_timezone:TZ})]);
  assert.equal(f.row('deadlines',d.deadline.link).at,'2035-01-02T08:00:00.000Z');
  assert.equal(f.row('items',task).starts_at,'2035-01-02T08:00:00.000Z');
  const b=f.write([{key:'unscheduled',type:'create_item',data:{kind:'visit',title:'Unknown time'}},link('rule','deadline_rule',{task_id:task,anchor_placement_id:ref('unscheduled','placement')},{anchor:'start',offset_minutes:-120,rule_timezone:TZ})]);
  assert.equal(f.row('deadlines',d.deadline.link).at,null);
  assert.equal(f.model().derived.deadlines.find(x=>x.task_id===task).complete,false);
  f.write([f.change('deadline_rules',b.rule.link,'remove_deadline_rule')]);
  f.write([f.change('items',task,'set_task_state',{state:'done'})]);
  f.write([f.change('deadline_rules',d.rule.link,'set_deadline_rule',{task_id:task,anchor_placement_id:a.visit.placement,data:{offset_days:-3}})]);
  assert.equal(f.row('deadlines',d.deadline.link).at,'2035-01-02T08:00:00.000Z');
  f.write([f.change('items',task,'set_task_state',{state:'open'})]);
  assert.equal(f.row('deadlines',d.deadline.link).at,'2035-01-01T08:00:00.000Z');
});

test('calendar-day deadline offset preserves wall time across DST; period tasks retain their original reminder anchor',async t=>{
  const f=await fixture(t,{upgrade:false});
  const task=(await (await applyPlanningChange(f.db,f.user,{path:'/api/planning/items',method:'POST',creationId:'period',body:{kind:'task',title:'Prepare',date_start:'2035-03-01',date_end:'2035-03-05'}})).json()).item;
  upgradePlanningModel(f.db,f.user,NOW);
  const ids=f.write([{key:'visit',type:'create_item',data:{kind:'visit',title:'DST'}},{key:'slot',type:'upsert_placement',id:ref('visit','placement'),expected_version:1,data:{precision:'exact',starts_at:'2035-03-12T16:00:00.000Z',ends_at:'2035-03-12T17:00:00.000Z',start_timezone:'America/New_York',end_timezone:'America/New_York'}},
    link('target','deadline',{}, {task_id:task.id,mode:'relative',timezone:'America/New_York'}),link('rule','deadline_rule',{task_id:task.id,anchor_placement_id:ref('visit','placement')},{offset_days:-2,rule_timezone:'America/New_York'})]);
  assert.equal(f.row('deadlines',ids.target.link).at,'2035-03-10T17:00:00.000Z');
  assert.equal(f.row('items',task.id).date_start,'2035-03-01');assert.equal(f.row('items',task.id).date_end,'2035-03-05');
});

test('invalidated preparation retires queued reminders; sent generations and supplier action tasks survive',async t=>{
  const f=await fixture(t),ids=f.write(visitCommands()),task=ids.visitprep.item;
  run(f.db,"INSERT INTO planning_reminders(id,user_id,item_id,enabled,mode,local_time,fires_at,updated_at) VALUES('r','editor',?,1,'day','10:00',?,1)",task,NOW);
  // A delivery can already be queued when another member retires the need.
  run(f.db,"INSERT INTO push_devices(id,user_id,session_hash,endpoint,p256dh,auth,enabled,enabled_from,installation_id,name,last_seen) SELECT 'device','editor',token_hash,'https://push.example.test','key','auth',1,0,'install','Test',1 FROM sessions WHERE user_id='editor'");
  run(f.db,"INSERT INTO push_deliveries(id,reminder_id,generation,device_id,state,next_at,expires_at) VALUES('queued','r',1,'device','queued',?,?)",NOW,NOW+60000);
  f.write([f.change('needs',ids.visitneed.need,'set_need_lifecycle',{lifecycle:'waived',reason:'No ticket required'})]);
  assert.equal(one(f.db,"SELECT state FROM push_deliveries WHERE id='queued'").state,'expired');
  let sent=0;const scheduler=createPushScheduler(f.db,async()=>{sent++;return 'sent';},{now:()=>NOW});await scheduler.tick();assert.equal(sent,0);
  assert.equal(f.row('items',task).state,'open');
  assert.equal(f.model().derived.tasks.find(t=>t.id===task).applicable,false);
  // Restoring applicability does not replay a generation already delivered to the person.
  run(f.db,"UPDATE planning_reminders SET generation=4,sent_generation=4 WHERE id='r'");
  f.write([f.change('needs',ids.visitneed.need,'set_need_lifecycle',{lifecycle:'active',reason:'Ticket needed again'})]);
  assert.equal(one(f.db,"SELECT generation FROM planning_reminders WHERE id='r'").generation,4);
  assert.equal(one(f.db,"SELECT sent_generation FROM planning_reminders WHERE id='r'").sent_generation,4);
  assert.equal(f.model().derived.tasks.find(t=>t.id===task).applicable,true);
});

test('supplier changes roll back with relations and history on SQL failure; repeated apply remains exactly once',async t=>{
  const f=await fixture(t),ids=f.write(visitCommands()),preview=f.preview(ticketCommands(ids.visitneed.need));
  const before=fingerprint(f.sources()),events=one(f.db,'SELECT count(*) n FROM planning_events').n;
  run(f.db,"CREATE TRIGGER reject_result BEFORE INSERT ON planning_need_services BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.throws(()=>f.apply(preview),/test failure/);assert.equal(fingerprint(f.sources()),before);assert.equal(one(f.db,'SELECT count(*) n FROM planning_events').n,events);
  run(f.db,'DROP TRIGGER reject_result');const applied=f.apply(preview);assert.deepEqual(f.apply(preview),applied);
  assert.equal(f.sources().services.length,1);assert.deepEqual(all(f.db,'PRAGMA foreign_key_check'),[]);
});

test('multi-segment flight split retains endpoints, passengers and supplier deadlines; partial cancellation is isolated',async t=>{
  const f=await fixture(t),ids=f.write(visitCommands({kind:'transport'})),places=f.sources().places;
  const arrival=places.find(p=>p.id!=='taipei-101').id,mid=places.find(p=>!['taipei-101',arrival].includes(p.id)).id;
  f.write([{key:'arrival',type:'link_place',placement_id:ids.visit.placement,expected_version:0,data:{place_id:arrival,role:'arrival'}}]);
  const booked=f.write([...ticketCommands(ids.visitneed.need,{kind:'transport'}),link('arrival','service_place',{service_id:ref('ticket','service')},{place_id:arrival,role:'arrival'}),
    link('cancel','deadline',{}, {service_id:ref('ticket','service'),kind:'cancel_by',at:'2035-01-01T08:00:00.000Z',timezone:TZ,origin:'provider'})]);
  assert.equal(f.model().derived.needs[0].status,'satisfied');
  const split={mode:'segments',reason:'Supplier returned individual coupons',parts:[
    {starts_at:'2035-01-04T08:00:00.000Z',ends_at:'2035-01-04T08:20:00.000Z',start_timezone:TZ,end_timezone:TZ,places:[{role:'departure',place_id:'taipei-101'},{role:'arrival',place_id:mid}],allocations:[]},
    {starts_at:'2035-01-04T08:40:00.000Z',ends_at:'2035-01-04T09:00:00.000Z',start_timezone:TZ,end_timezone:TZ,places:[{role:'departure',place_id:mid},{role:'arrival',place_id:arrival}],allocations:[]},
  ]};
  assert.throws(()=>f.preview([f.change('services',booked.ticket.service,'split_service',{...split,parts:[split.parts[0],{...split.parts[1],places:[{role:'departure',place_id:arrival},{role:'arrival',place_id:arrival}]}]})]),code('SPLIT_ENDPOINTS_UNVERIFIED'));
  const result=f.write([f.change('services',booked.ticket.service,'split_service',split)]);
  assert.equal(f.row('services',result.change.service_0).capacity_units,1);
  assert.equal(f.row('services',result.change.service_1).capacity_units,1);
  f.write([f.change('services',result.change.service_1,'set_service_state',{state:'cancelled',reason:'Second coupon cancelled'})]);
  assert.equal(f.row('services',result.change.service_0).state,'confirmed');
  const registry=bookingRegistry(f.db,f.user,booked.ticketbooking.booking).bookings[0];
  assert.equal(registry.state,'mixed');
  assert.equal(registry.services.find(s=>s.id===result.change.service_0).deadlines[0].applicable,true);
  assert.equal(registry.services.find(s=>s.id===result.change.service_1).deadlines[0].applicable,false);
  assert.equal(f.model().derived.needs[0].status,'missing'); // No invented connection from one long placement to two flight legs.
});

test('capacity splitting preserves total tickets and requires explicit distribution of existing needs',async t=>{
  const f=await fixture(t),ids=f.write(visitCommands({units:2})),booked=f.write(ticketCommands(ids.visitneed.need,{capacity:2}));
  assert.throws(()=>f.preview([f.change('services',booked.ticket.service,'split_service',{mode:'capacity',parts:[{capacity_units:1},{capacity_units:2}],reason:'Wrong sum'})]),code('SPLIT_CAPACITY_CHANGED'));
  assert.throws(()=>f.preview([f.change('services',booked.ticket.service,'split_service',{mode:'capacity',parts:[{capacity_units:1},{capacity_units:1}],reason:'Missing mapping'})]),code('SPLIT_ALLOCATIONS_REQUIRED'));
  const result=f.write([f.change('services',booked.ticket.service,'split_service',{mode:'capacity',parts:[{capacity_units:1,allocations:[{need_id:ids.visitneed.need}]},{capacity_units:1,allocations:[{need_id:ids.visitneed.need}]}],reason:'One person may cancel'}),
    {key:'cancel',type:'set_service_state',id:{command:'change',entity:'service',part:0},expected_version:1,state:'cancelled',reason:'One ticket returned'}]);
  assert.equal(f.row('services',result.change.service_0).state,'cancelled');
  assert.equal(f.model().derived.needs[0].status,'partial');
  assert.equal(f.sources().services.filter(s=>s.state==='confirmed').reduce((n,s)=>n+s.capacity_units,0),1);
});

test('reusable pass needs explicit sharing and known use limits; same occurrence still cannot over-allocate passengers',async t=>{
  const f=await fixture(t),a=f.write(visitCommands()),b=f.write(visitCommands({key:'b',date:'2035-01-05'}));
  const purchase=ticketCommands(a.visitneed.need,{data:{validity:'date_range',starts_at:null,date_start:'2035-01-04',date_end:'2035-01-05',terms:{schema_version:1,usage:'reusable'}}});
  purchase.at(-1).data={use_mode:'shared'};
  const booked=f.write([...purchase,link('other','need_service',{need_id:b.bneed.need,service_id:ref('ticket','service')},{use_mode:'shared'})]);
  assert(f.model().derived.issues.some(i=>i.code==='SERVICE_USE_LIMIT_UNKNOWN'));
  f.write([f.change('services',booked.ticket.service,'correct_service',{data:{terms:{schema_version:1,usage:'reusable',allowed_uses:2}},reason:'Two admissions allowed'})]);
  assert(f.model().derived.needs.every(n=>n.status==='satisfied'));
  const extra=f.write(visitCommands({key:'extra',date:'2035-01-05'}));
  f.write([link('extra','need_service',{need_id:extra.extraneed.need,service_id:booked.ticket.service},{use_mode:'shared'})]);
  assert(f.model().derived.issues.some(i=>i.code==='SERVICE_OVERALLOCATED'));
  assert.equal(f.model().derived.needs.find(n=>n.id===a.visitneed.need).status,'satisfied');
  assert.notEqual(f.model().derived.needs.find(n=>n.id===b.bneed.need).status,'satisfied');
});

test('moving an unbooked item recalculates preparation targets; supplier deadlines remain fixed and warn about conflicts',async t=>{
  const f=await fixture(t),ids=f.write(visitCommands()),task=ids.visitprep.item;
  const deadline=f.write([link('target','deadline',{}, {task_id:task,mode:'relative',timezone:TZ}),link('rule','deadline_rule',{task_id:task,anchor_placement_id:ids.visit.placement},{offset_days:-1,rule_timezone:TZ})]);
  f.write([f.change('placements',ids.visit.placement,'upsert_placement',{data:{starts_at:'2035-01-06T08:00:00.000Z',ends_at:'2035-01-06T09:00:00.000Z'}})]);
  assert.equal(f.row('deadlines',deadline.target.link).at,'2035-01-05T08:00:00.000Z');
  const booked=f.write([...ticketCommands(ids.visitneed.need,{date:'2035-01-06',state:'pending'}),link('sales','deadline',{}, {service_id:ref('ticket','service'),kind:'sales_close',local_date:'2035-01-04',timezone:TZ,origin:'provider'})]);
  assert(f.model().derived.issues.some(i=>i.code==='TARGET_AFTER_SUPPLIER_DEADLINE'));
  f.write([f.change('placements',ids.visit.placement,'upsert_placement',{data:{starts_at:'2035-01-07T08:00:00.000Z',ends_at:'2035-01-07T09:00:00.000Z'}})]);
  assert.equal(f.row('deadlines',booked.sales.link).local_date,'2035-01-04');
  f.write([f.change('services',booked.ticket.service,'set_service_state',{state:'confirmed',reason:'Paid'})]);
  const blocked=f.preview([f.change('placements',ids.visit.placement,'upsert_placement',{data:{starts_at:'2035-01-08T08:00:00.000Z',ends_at:'2035-01-08T09:00:00.000Z'}})]);
  assert.equal(blocked.preview.can_apply,false);assert.throws(()=>f.apply(blocked),code('SCHEDULE_BLOCKED'));
});

test('strict validation rejects unsupported criteria, wrong task links, reused one-shot tickets and cross-trip owners',async t=>{
  const f=await fixture(t),ids=f.write(visitCommands()),booked=f.write(ticketCommands(ids.visitneed.need));
  assert.throws(()=>f.preview([{key:'wrong',type:'create_need',data:{kind:'admission',label:'Unsafe',criteria:{schema_version:1,require_confirmed:false}}}]),code('UNSUPPORTED_CRITERIA'));
  assert.throws(()=>f.preview([link('wrong','need_task',{need_id:ids.visitneed.need,task_id:ids.visit.item})]),code('TASK_REQUIRED'));
  assert.throws(()=>f.preview([f.change('need_services',booked.ticketallocation.link,'set_need_service',{need_id:ids.visitneed.need,service_id:booked.ticket.service,data:{use_mode:'shared'}})]),code('SERVICE_NOT_REUSABLE'));
  assert.throws(()=>f.preview([{key:'missing',type:'add_service',booking_id:'other-trip-booking',data:{title:'Unknown'}}]),code('TARGET_UNAVAILABLE'));
  assert.throws(()=>f.preview([f.change('services',booked.ticket.service,'correct_service',{data:{state:'cancelled'},reason:''})]),code('INVALID_TEXT'));
  const before=fingerprint(f.sources());
  assert.throws(()=>f.preview([f.change('services',booked.ticket.service,'correct_service',{data:{terms:{schema_version:1,allowed_uses:0}},reason:'Bad terms'})]),code('INVALID_TERMS'));
  assert.equal(fingerprint(f.sources()),before);
});

test('0015 upgrades a copy of populated stage-1 storage without changing existing rows or source database',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'taiwan-stage2-')),migrations=join(directory,'migrations');
  const {mkdirSync}=await import('node:fs');mkdirSync(migrations);
  for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')&&n<'0015'))copyFileSync(join('drizzle',name),join(migrations,name));
  const original=openDatabase(join(directory,'source.sqlite'));t.after(()=>{original.close();rmSync(directory,{recursive:true,force:true});});migrate(original,migrations);await seed(original);
  run(original,"INSERT INTO users(id,display_name,created_at) VALUES('editor','Editor',1)");run(original,"INSERT INTO memberships VALUES(?,'editor','editor')",TRIP);
  const user={id:'editor',role:'editor'};
  await applyPlanningChange(original,user,{path:'/api/planning/items',method:'POST',creationId:'legacy-stay',body:{kind:'stay',title:'Booked hotel',note:'Keep original',date_start:'2035-01-04',date_end:'2035-01-07',places:[{place_id:'taipei-101',role:'lodging'}]}});
  upgradePlanningModel(original,user,NOW);
  const tableNames=all(original,"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_app_migrations' ORDER BY name").map(t=>t.name);
  const columns=Object.fromEntries(tableNames.map(name=>[name,all(original,'PRAGMA table_info('+name+')').map(c=>c.name)]));
  const snapshot=db=>Object.fromEntries(tableNames.map(name=>[name,all(db,'SELECT '+columns[name].join(',')+' FROM '+name+' ORDER BY rowid')]));
  const before=snapshot(original),hash=fingerprint(before);
  await backup(original.sqlite,join(directory,'copy.sqlite'));
  const copy=openDatabase(join(directory,'copy.sqlite'));t.after(()=>copy.close());migrate(copy,'drizzle');
  assert.deepEqual(snapshot(copy),before);assert.equal(fingerprint(snapshot(original)),hash);
  assert.deepEqual(all(copy,'PRAGMA foreign_key_check'),[]);assert.equal(one(copy,'PRAGMA integrity_check').integrity_check,'ok');
  const model=readModel3(copy,user,NOW);assert.equal(model.derived.housing_coverage.length,3);assert.equal(model.derived.needs[0].status,'unknown');
  migrate(copy,'drizzle');assert.deepEqual(snapshot(copy),before);
  assert.equal(one(original,"SELECT count(*) n FROM _app_migrations WHERE name LIKE '0015%'").n,0);
});

test('removing a place preserves booking labels, invalidates readiness and does not fabricate a replacement location',async t=>{
  const f=await fixture(t),ids=f.write(visitCommands()),booked=f.write(ticketCommands(ids.visitneed.need));
  await handlePlaceLifecycle(new Request('https://example.test/api/places/taipei-101',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1})}),f.db,f.user,'editor');
  assert.equal(f.row('service_places',booked.ticketplace.link).place_id,null);
  assert(f.row('service_places',booked.ticketplace.link).label_snapshot.length>0);
  assert.equal(f.model().derived.needs[0].status,'unknown');
  assert.equal(f.row('services',booked.ticket.service).state,'confirmed');
});

test('used tickets cannot provide a future admission; unknown placeholders cannot be verified as chosen locations',async t=>{
  const f=await fixture(t),ids=f.write(visitCommands()),booked=f.write(ticketCommands(ids.visitneed.need));
  f.write([f.change('services',booked.ticket.service,'set_service_state',{state:'used',reason:'Already used'})]);
  assert.equal(f.model().derived.needs[0].status,'missing');
  const empty=f.write([{key:'v',type:'create_item',data:{kind:'visit',title:'Unchosen place'}},{key:'n',type:'create_need',data:{kind:'admission',label:'Entry',required_units:1,unit_type:'person'}},link('target','need_target',{need_id:ref('n','need'),placement_id:ref('v','placement')})]);
  f.write([...ticketCommands(empty.n.need,{key:'other',place:null}),{key:'slot',type:'upsert_placement',id:empty.v.placement,expected_version:f.row('placements',empty.v.placement).version,data:{precision:'exact',starts_at:'2035-01-04T08:00:00.000Z',ends_at:'2035-01-04T09:00:00.000Z',start_timezone:TZ,end_timezone:TZ}}]);
  const allocation=f.sources().need_services.find(l=>l.need_id===empty.n.need);
  f.write([f.change('need_services',allocation.id,'set_need_service',{need_id:empty.n.need,service_id:allocation.service_id,data:{verify_place:true,context_note:'Same name'}})]);
  assert.equal(f.model().derived.needs.find(n=>n.id===empty.n.need).status,'unknown');
});
