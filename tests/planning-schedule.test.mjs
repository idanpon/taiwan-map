import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase,migrate } from '../server/database.mjs';
import { seed } from '../src/seed.mjs';
import { TRIP,sha } from '../src/auth.mjs';
import { run,all,one } from '../src/sqlite.mjs';
import { upgradePlanningModel } from '../src/planning-upgrade.mjs';
import { readSources,fingerprint } from '../src/planning-domain-store.mjs';
import { readModel3,createChangeset,previewChangeset,applyChangeset,evaluatePlanning,applyMetadataCommands } from '../src/planning-command-service.mjs';
import { distanceBuffer,haversine,transition,transitionContext } from '../public/planning-transitions.js';
import { handle } from '../src/core.mjs';
import { applyPlanningChange } from '../src/planning.mjs';
import { mkdtempSync,readdirSync,copyFileSync,mkdirSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backup } from 'node:sqlite';

const NOW=Date.parse('2030-01-01T00:00:00Z'),TZ='Asia/Taipei',time=h=>'2035-01-04T'+h+':00.000Z';
const ref=(command,entity)=>({command,entity}),code=expected=>e=>e.details?.code===expected;
const link=(key,type,refs,data)=>({key,type,expected_version:0,...refs,data});
async function fixture(t){
  const db=openDatabase();migrate(db,'drizzle');await seed(db);t.after(()=>db.close());
  run(db,"INSERT INTO app_meta(key,value) VALUES('accounts_v1','shared')");
  for(const [id,role] of [['editor','editor'],['viewer','viewer']]){run(db,'INSERT INTO users(id,display_name,created_at) VALUES(?,?,1)',id,id);run(db,'INSERT INTO memberships VALUES(?,?,?)',TRIP,id,role);}
  const user={id:'editor',role:'editor'},viewer={id:'viewer',role:'viewer'};upgradePlanningModel(db,user,NOW);
  const sources=()=>readSources(db).sources,row=(c,id)=>sources()[c].find(x=>x.id===id),model=()=>readModel3(db,user,NOW);
  const preview=(commands,now=NOW,actor=user)=>{const d=createChangeset(db,actor,{version:3,commands},now);return previewChangeset(db,actor,d.id,{version:d.version},now);};
  const apply=(p,{ack=p.preview.allowed_acknowledgements,now=NOW,actor=user,key='apply-'+p.id}={})=>applyChangeset(db,actor,p.id,{version:p.version,fingerprint:p.preview.fingerprint,idempotency_key:key,acknowledgements:ack},now);
  const write=commands=>{const p=preview(commands);assert.equal(p.preview.can_apply,true,JSON.stringify(p.preview.issues.filter(i=>i.blocking)));apply(p);return p.preview.resolved_ids;};
  const change=(collection,id,type,more={})=>({key:'change',type,id,expected_version:row(collection,id).version,...more});
  const token='8'.repeat(64);run(db,'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',await sha(token),user.id,Date.now()+86400000);
  const call=(path,method='GET',data)=>handle(new Request('https://example.test'+path,{method,headers:{Authorization:'Bearer '+token,Origin:'https://example.test','Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),{DB:db,APP_ORIGIN:'https://example.test',AUTH_MODE:'bearer'});
  return {db,user,viewer,row,sources,model,preview,apply,write,change,call};
}
function visit(key,start,end,{kind='visit',point='taipei-101',precision='exact',extra={}}={}){
  return [{key,type:'create_item',data:{kind,title:key,note:'Preserve '+key}},
    {key:key+'slot',type:'upsert_placement',id:ref(key,'placement'),expected_version:1,data:{precision,starts_at:time(start),ends_at:time(end),start_timezone:TZ,end_timezone:TZ,...extra}},
    {key:key+'place',type:'link_place',placement_id:ref(key,'placement'),expected_version:0,data:{place_id:point,role:kind==='transport'?'departure':kind==='stay'?'lodging':'visit'}}];
}
function ticket(p,{start='10:30',end=null,lead=0,state='confirmed',extra={}}={}){
  return [{key:'need',type:'create_need',data:{kind:'admission',label:'Entry',required_units:1,unit_type:'person'}},link('target','set_need_target',{need_id:ref('need','need'),placement_id:p},{}),
    {key:'booking',type:'record_booking',data:{category:'activity'}},{key:'service',type:'add_service',booking_id:ref('booking','booking'),data:{kind:'admission',state,title:'Actual entry',validity:end?'exact_interval':'exact_start',starts_at:time(start),start_timezone:TZ,...(end?{ends_at:time(end),end_timezone:TZ}:{}),capacity_units:1,unit_type:'person',arrival_lead_minutes:lead,...extra}},
    link('serviceplace','set_service_place',{service_id:ref('service','service')},{place_id:'taipei-101',role:'visit'}),link('allocation','set_need_service',{need_id:ref('need','need'),service_id:ref('service','service')},{})];
}
function chain(f,{booked=true}={}){
  const ids=f.write([...visit('walk','06:00','07:00'),...visit('gallery','07:20','08:10'),...visit('coffee','08:25','08:55'),...visit('tower','10:30','11:30')]);
  const buffers=f.write([link('a','set_transition_override',{from_placement_id:ids.walk.placement,to_placement_id:ids.gallery.placement},{mode:'manual',minutes:20}),link('b','set_transition_override',{from_placement_id:ids.gallery.placement,to_placement_id:ids.coffee.placement},{mode:'manual',minutes:15}),link('c','set_transition_override',{from_placement_id:ids.coffee.placement,to_placement_id:ids.tower.placement},{mode:'manual',minutes:30})]);
  return {...ids,buffers,...(booked?f.write(ticket(ids.tower.placement)): {})};
}

test('distance policy uses raw metre breakpoints, 100 km cap, unknown 15; Haversine accepts zero and crosses dateline',()=>{
  for(const [m,n] of [[0,10],[500,10],[500.0001,20],[1000,20],[1000.0001,30],[3000,30],[3000.0001,45],[5000,45],[5000.01,60],[10000,60],[10000.1,90],[30000,90],[30000.1,120],[60000,120],[60000.1,150],[90000,150],[90000.1,180],[100000,180],[100000.1,null],[null,15]])assert.equal(distanceBuffer(m).minutes,n,String(m));
  assert.equal(distanceBuffer(100000.1).status,'unresolved_long_transfer');
  assert.equal(haversine({lat:0,lon:0},{lat:0,lon:0}),0);
  assert(haversine({lat:0,lon:179.9},{lat:0,lon:-179.9})<23000);
});

test('group preview fits three changes before a fixed ticket; apply preserves facts, notes and IDs',async t=>{
  const f=await fixture(t),ids=chain(f),before=fingerprint(f.sources());
  const p=f.preview([f.change('placements',ids.walk.placement,'apply_group_shift',{data:{starts_at:time('07:00'),direction:'forward'}})]);
  assert.equal(p.preview.can_apply,true);assert.equal(fingerprint(f.sources()),before);
  assert.equal(p.preview.groups[0].changes.length,3);
  const proposed=p.preview.changes.find(c=>c.collection==='placements'&&c.id===ids.coffee.placement).after;
  assert.equal(proposed.ends_at,time('09:55'));assert.equal(p.preview.groups[0].boundary.placement_id,ids.tower.placement);
  const result=f.apply(p);assert.deepEqual(f.apply(p),result);
  assert.equal(f.row('services',ids.service.service).starts_at,time('10:30'));
  assert.equal(f.row('placements',ids.tower.placement).starts_at,time('10:30'));
  assert.equal(f.row('items',ids.coffee.item).note,'Preserve coffee');assert.equal(f.row('items',ids.coffee.item).starts_at,time('09:25'));
  assert.equal(f.sources().items.length,4);assert.equal(f.sources().placement_places.length,4);
});

test('group never commits a partial prefix past a fixed ticket and suggests the computed 15:05 local boundary',async t=>{
  const f=await fixture(t),ids=chain(f),before=fingerprint(f.sources());
  const p=f.preview([f.change('placements',ids.walk.placement,'apply_group_shift',{data:{starts_at:time('08:00'),direction:'forward'}})]);
  assert.equal(p.preview.can_apply,false);assert.equal(p.preview.groups[0].nearest_start,time('07:05'));
  assert(p.preview.issues.some(i=>i.code==='GROUP_FIXED_BOUNDARY'&&i.values.shortfall_minutes===55));
  assert.throws(()=>f.apply(p),code('SCHEDULE_BLOCKED'));assert.equal(fingerprint(f.sources()),before);
  const boundary=f.preview([f.change('placements',ids.walk.placement,'apply_group_shift',{data:{starts_at:p.preview.groups[0].nearest_start,direction:'forward'}})]);
  assert.equal(boundary.preview.can_apply,true);f.apply(boundary);assert.equal(f.row('placements',ids.coffee.placement).ends_at,time('10:00'));
});

test('backward is a reverse propagation, absorbs slack and stops at the preceding pin',async t=>{
  const f=await fixture(t),ids=chain(f,{booked:false});
  f.write([link('pin','set_time_constraint',{placement_id:ids.walk.placement},{kind:'fixed_start',values:{at:time('06:00')},reason:'Appointment'})]);
  const p=f.preview([f.change('placements',ids.tower.placement,'apply_group_shift',{data:{starts_at:time('09:15'),direction:'backward'}})]);
  assert.equal(p.preview.can_apply,false);assert.equal(p.preview.groups[0].nearest_start,time('09:25'));
  const valid=f.preview([f.change('placements',ids.tower.placement,'apply_group_shift',{data:{starts_at:time('09:25'),direction:'backward'}})]);
  assert.equal(valid.preview.can_apply,true);f.apply(valid);
  assert.equal(f.row('placements',ids.walk.placement).starts_at,time('06:00'));
  assert.equal(f.row('placements',ids.coffee.placement).starts_at,time('08:25'));
});

test('approved intervals cannot overlap; touching intervals and tentative conflicts have distinct outcomes',async t=>{
  const f=await fixture(t),ids=f.write([...visit('a','06:00','07:00'),...visit('b','06:30','07:30')]);
  f.write([f.change('placements',ids.a.placement,'approve_placement')]);
  let p=f.preview([f.change('placements',ids.b.placement,'approve_placement')]);assert.equal(p.preview.can_apply,false);assert(p.preview.issues.some(i=>i.code==='SCHEDULE_OVERLAP'&&i.blocking));
  assert.throws(()=>f.apply(p),code('SCHEDULE_BLOCKED'));
  f.write([f.change('placements',ids.b.placement,'upsert_placement',{data:{starts_at:time('07:00'),ends_at:time('08:00')}})]);
  p=f.preview([f.change('placements',ids.b.placement,'approve_placement')]);assert.equal(p.preview.can_apply,true);assert(p.preview.issues.some(i=>i.code==='TRANSITION_BUFFER_SHORT'&&!i.blocking));f.apply(p);
  assert.equal(f.model().derived.schedule.placements.find(p=>p.id===ids.b.placement).requires_review,false);
  const bad=f.preview([f.change('placements',ids.b.placement,'upsert_placement',{data:{starts_at:time('06:45'),ends_at:time('07:45')}})]);assert.equal(bad.preview.can_apply,false);
});

test('fixed-start allows duration editing; several independent reasons intersect and supplier changes remain recordable',async t=>{
  const f=await fixture(t),ids=f.write(visit('tower','10:30','11:30')),book=f.write(ticket(ids.tower.placement));
  f.write([f.change('placements',ids.tower.placement,'approve_placement')]);
  f.write([f.change('placements',ids.tower.placement,'upsert_placement',{data:{ends_at:time('12:00')}})]);
  f.write([link('max','set_time_constraint',{placement_id:ids.tower.placement},{kind:'max_duration',values:{minutes:100},reason:'Close before lunch'})]);
  assert.equal(f.model().derived.schedule.placements[0].requires_review,true);
  let p=f.preview([f.change('placements',ids.tower.placement,'upsert_placement',{data:{ends_at:time('12:30')}})]);assert.equal(p.preview.can_apply,false);
  f.write([f.change('services',book.service.service,'correct_service',{data:{starts_at:time('11:00')},reason:'Supplier changed entry'})]);
  assert.equal(f.row('placements',ids.tower.placement).starts_at,time('10:30'));
  assert.equal(f.row('placements',ids.tower.placement).commitment,'approved');assert.equal(f.model().derived.schedule.placements[0].requires_review,true);
  // An unrelated title remains editable despite the historical mismatch.
  applyMetadataCommands(f.db,f.user,{version:3,idempotency_key:'title',commands:[f.change('items',ids.tower.item,'edit_item',{data:{title:'Tower updated'}})]},NOW);
});

test('reschedule needs exact pin acknowledgements, reuses open exchange work and never changes the actual ticket',async t=>{
  const f=await fixture(t),ids=f.write(visit('tower','10:30','11:30')),book=f.write(ticket(ids.tower.placement));
  const p=f.preview([f.change('placements',ids.tower.placement,'request_reschedule',{data:{starts_at:time('11:30')},reason:'Prefer later'})]);
  assert.equal(p.preview.can_apply,true);assert.equal(p.preview.allowed_acknowledgements.length,1);
  assert.throws(()=>f.apply(p,{ack:[]}),code('ACKNOWLEDGEMENTS_REQUIRED'));
  assert.throws(()=>f.apply(p,{ack:['all']}),code('ACKNOWLEDGEMENTS_REQUIRED'));
  f.apply(p);const task=p.preview.resolved_ids.change.item;
  assert.equal(f.row('placements',ids.tower.placement).commitment,'tentative');assert.equal(f.row('services',book.service.service).starts_at,time('10:30'));
  assert.equal(f.model().derived.needs[0].status,'mismatch');assert.equal(f.sources().service_tasks[0].task_id,task);
  const second=f.preview([f.change('placements',ids.tower.placement,'request_reschedule',{data:{starts_at:time('12:00')},reason:'Later still'})]);assert.equal(second.preview.resolved_ids.change.item,task);f.apply(second);
  assert.equal(f.sources().reschedule_requests.length,1);assert.equal(f.sources().service_tasks.length,1);
  const approve=f.preview([f.change('placements',ids.tower.placement,'approve_placement')]);assert.equal(approve.preview.can_apply,false);
});

test('reschedule acknowledgement cannot approve a conflicting ticket in the same package; final intent follows command order',async t=>{
  const f=await fixture(t),ids=f.write(visit('tower','10:30','11:30'));f.write(ticket(ids.tower.placement));
  const request=f.change('placements',ids.tower.placement,'request_reschedule',{key:'request',data:{starts_at:time('11:30')},reason:'Later entry'});
  const approve=f.change('placements',ids.tower.placement,'approve_placement',{key:'approve'}),before=fingerprint(f.sources());
  const bad=f.preview([request,approve]);assert.equal(bad.preview.can_apply,false);assert(bad.preview.issues.some(i=>i.code==='PIN_MISMATCH'&&i.blocking));
  assert.throws(()=>f.apply(bad),code('SCHEDULE_BLOCKED'));assert.equal(fingerprint(f.sources()),before);
  const tentative=f.preview([approve,request]);assert.equal(tentative.preview.can_apply,true);assert.equal(tentative.preview.allowed_acknowledgements.length,1);f.apply(tentative);
  assert.equal(f.row('placements',ids.tower.placement).commitment,'tentative');assert.equal(f.row('placements',ids.tower.placement).approved_context_json,null);
});

test('buffer overrides follow endpoint context, survive clock/name edits, and expire after coordinates change',async t=>{
  const f=await fixture(t),ids=f.write([...visit('a','06:00','07:00'),...visit('b','07:30','08:00')]);
  const override=f.write([link('buffer','set_transition_override',{from_placement_id:ids.a.placement,to_placement_id:ids.b.placement},{mode:'disabled',note:'Same building'})]);
  assert.equal(f.model().derived.schedule.transitions[0].required_minutes,0);
  f.write([f.change('placements',ids.b.placement,'upsert_placement',{data:{starts_at:time('08:30'),ends_at:time('09:00')}})]);
  run(f.db,"UPDATE places SET name='New label' WHERE id='taipei-101'");assert.equal(f.model().derived.schedule.transitions[0].mode,'disabled');
  run(f.db,"UPDATE places SET lat=lat+0.001 WHERE id='taipei-101'");
  const changed=f.model().derived.schedule.transitions[0];assert.equal(changed.mode,'auto');assert.deepEqual(changed.stale_override_ids,[override.buffer.link]);
  assert.equal(f.row('transition_overrides',override.buffer.link).archived_at,null);
});

test('unknown distance is 15, over 100 km is unresolved, and disabled buffer preserves ticket arrival conditions',async t=>{
  const f=await fixture(t),point=f.sources().places.find(p=>p.id!=='taipei-101').id;
  run(f.db,"UPDATE places SET lat=0,lon=0 WHERE id='taipei-101'");run(f.db,'UPDATE places SET lat=0,lon=2 WHERE id=?',point);
  const ids=f.write([...visit('a','06:00','07:00'),...visit('b','10:30','11:30',{point})]);f.write(ticket(ids.b.placement,{lead:25}));
  const gap=f.model().derived.schedule.transitions[0];assert.equal(gap.required_minutes,null);assert.equal(gap.suggested_minutes,null);
  assert.throws(()=>f.preview([link('accept','set_transition_override',{from_placement_id:ids.a.placement,to_placement_id:ids.b.placement},{mode:'accepted'})]),code('INVALID_BUFFER_MINUTES'));
  let p=f.preview([f.change('placements',ids.a.placement,'apply_group_shift',{data:{starts_at:time('06:10'),direction:'forward'}})]);assert.equal(p.preview.can_apply,false);
  f.write([link('disable','set_transition_override',{from_placement_id:ids.a.placement,to_placement_id:ids.b.placement},{mode:'disabled',note:'Separate travel arrangement'})]);
  assert.equal(f.model().derived.schedule.transitions[0].required_minutes,25);
  p=f.preview([f.change('placements',ids.a.placement,'apply_group_shift',{data:{starts_at:time('09:10'),direction:'forward'}})]);assert.equal(p.preview.can_apply,false);
  const s=f.sources();s.placement_places=s.placement_places.filter(l=>l.placement_id!==ids.a.placement);const fallback=transition(s,s.placements.find(p=>p.id===ids.a.placement),s.placements.find(p=>p.id===ids.b.placement),NOW);assert.equal(fallback.mode,'auto');assert.equal(fallback.required_minutes,40);
});

test('time links are typed, cycle-free and enforced even for non-neighbours; manual buffers cannot be bypassed by approval',async t=>{
  const f=await fixture(t),ids=f.write([...visit('a','06:00','07:00'),...visit('b','07:30','08:00'),...visit('c','09:00','09:30')]);
  f.write([link('precedence','set_time_link',{from_placement_id:ids.a.placement,to_placement_id:ids.c.placement},{minimum_minutes:180})]);
  assert.throws(()=>f.preview([link('cycle','set_time_link',{from_placement_id:ids.c.placement,to_placement_id:ids.a.placement},{minimum_minutes:0})]),code('TIME_LINK_CYCLE'));
  const p=f.preview([f.change('placements',ids.c.placement,'approve_placement')]);assert.equal(p.preview.can_apply,false);
  f.write([f.change('placements',ids.c.placement,'upsert_placement',{data:{starts_at:time('10:00'),ends_at:time('10:30')}})]);
  f.write([f.change('placements',ids.a.placement,'approve_placement')]);
  f.write([link('manual','set_transition_override',{from_placement_id:ids.a.placement,to_placement_id:ids.b.placement},{mode:'manual',minutes:60})]);
  const blocked=f.preview([f.change('placements',ids.b.placement,'approve_placement')]);assert.equal(blocked.preview.can_apply,false);
});

test('duration bounds distinguish a fixed ticket, movable neighbours, and unknown estimates',async t=>{
  const f=await fixture(t),ids=chain(f),limits=f.model().derived.schedule.duration_limits.find(l=>l.placement_id===ids.walk.placement);
  assert.equal(limits.without_shift.max_minutes,60);assert.equal(limits.with_shift.max_minutes,125);
  const p=f.preview([f.change('placements',ids.walk.placement,'apply_group_shift',{data:{starts_at:time('06:00'),duration_minutes:125,direction:'forward'}})]);assert.equal(p.preview.can_apply,true);
  assert.equal(p.preview.groups[0].changes.at(-1).after.ends_at,time('10:00'));
});

test('date-only uncertainty blocks propagation, but all-night stays do not occupy daytime activities',async t=>{
  const f=await fixture(t),ids=chain(f);
  f.write([{key:'stay',type:'create_item',data:{kind:'stay',title:'Night placeholder'}},{key:'dates',type:'upsert_placement',id:ref('stay','placement'),expected_version:1,data:{precision:'day',date_start:'2035-01-04',date_end:'2035-01-07'}}]);
  let p=f.preview([f.change('placements',ids.walk.placement,'apply_group_shift',{data:{starts_at:time('07:00'),direction:'forward'}})]);assert.equal(p.preview.can_apply,true);
  f.write([{key:'unknown',type:'create_item',data:{kind:'visit',title:'Unknown hour'}},{key:'day',type:'upsert_placement',id:ref('unknown','placement'),expected_version:1,data:{precision:'day',date_start:'2035-01-04'}}]);
  p=f.preview([f.change('placements',ids.walk.placement,'apply_group_shift',{data:{starts_at:time('07:00'),direction:'forward'}})]);assert.equal(p.preview.can_apply,false);assert(p.preview.issues.some(i=>i.code==='GROUP_ORDER_INCOMPLETE'));
});

test('explicit constraint release is authoritative over the legacy compatibility pin flag',async t=>{
  const f=await fixture(t),ids=f.write(visit('a','06:00','07:00'));
  run(f.db,'UPDATE planning_items SET fixed_external=1 WHERE id=?',ids.a.item);
  const pin=f.write([link('pin','set_time_constraint',{placement_id:ids.a.placement},{kind:'fixed_start',values:{at:time('06:00')},reason:'Legacy appointment'})]);
  const move=()=>f.change('placements',ids.a.placement,'apply_group_shift',{data:{starts_at:time('07:00'),direction:'forward'}});
  assert.equal(f.preview([move()]).preview.can_apply,false);
  f.write([f.change('constraints',pin.pin.link,'remove_time_constraint',{reason:'Appointment released'})]);
  const p=f.preview([move()]);assert.equal(p.preview.can_apply,true);f.apply(p);
  assert.equal(f.row('placements',ids.a.placement).starts_at,time('07:00'));assert.equal(f.row('constraints',pin.pin.link).archived_at,NOW);
});

test('equal start times never acquire an artificial propagation order from generated IDs',async t=>{
  const f=await fixture(t),ids=f.write([...visit('before','04:00','05:00'),...visit('a','06:00','07:00'),...visit('b','06:00','06:30')]);
  for(const key of ['a','b'])for(const direction of ['forward','backward']){
    const p=f.preview([f.change('placements',ids[key].placement,'apply_group_shift',{data:{starts_at:time(direction==='forward'?'06:30':'05:30'),direction}})]);
    assert.equal(p.preview.can_apply,false);assert(p.preview.issues.some(i=>i.code==='GROUP_ORDER_AMBIGUOUS'));
    assert.equal(f.model().derived.schedule.duration_limits.find(l=>l.placement_id===ids[key].placement).with_shift.status,'unknown');
  }
  const fromBefore=f.preview([f.change('placements',ids.before.placement,'apply_group_shift',{data:{starts_at:time('06:00'),direction:'forward'}})]);
  assert.equal(fromBefore.preview.can_apply,false);assert(fromBefore.preview.issues.some(i=>i.code==='GROUP_ORDER_AMBIGUOUS'));
});

test('split hotel nights keep outer check-in/out conditions and shortening requires a reschedule acknowledgement',async t=>{
  const f=await fixture(t),ids=f.write([
    {key:'stay',type:'create_item',data:{kind:'stay',title:'Hotel'}},
    {key:'slot',type:'upsert_placement',id:ref('stay','placement'),expected_version:1,data:{precision:'exact',starts_at:time('07:00'),ends_at:'2035-01-07T03:00:00.000Z',start_timezone:TZ,end_timezone:TZ}},
    {key:'need',type:'create_need',data:{kind:'accommodation',label:'Hotel nights',required_units:1,unit_type:'room'}},
    link('target','set_need_target',{need_id:ref('need','need'),placement_id:ref('stay','placement')},{}),
    {key:'booking',type:'record_booking',data:{category:'lodging'}},
    {key:'service',type:'add_service',booking_id:ref('booking','booking'),data:{kind:'stay',state:'confirmed',validity:'date_range',title:'Three nights',date_start:'2035-01-04',date_end:'2035-01-07',start_timezone:TZ,end_timezone:TZ,terms:{schema_version:1,check_in_earliest:{local_time:'14:00',day_offset:0,timezone:TZ},check_in_latest:{local_time:'22:00',day_offset:0,timezone:TZ},check_out_latest:{local_time:'12:00',day_offset:0,timezone:TZ}}}},
    link('allocation','set_need_service',{need_id:ref('need','need'),service_id:ref('service','service')},{})
  ]);
  f.write([f.change('services',ids.service.service,'split_service',{mode:'nights',parts:[{date_start:'2035-01-04',date_end:'2035-01-06'},{date_start:'2035-01-06',date_end:'2035-01-07'}],reason:'Separate last night'})]);
  assert(!f.model().derived.schedule.issues.some(i=>i.hard));
  const withoutHours=f.preview([f.change('placements',ids.stay.placement,'upsert_placement',{data:{precision:'day',starts_at:null,ends_at:null}})]);
  assert.equal(withoutHours.preview.can_apply,true);assert(!withoutHours.preview.issues.some(i=>i.code==='TIME_CONSTRAINT_UNKNOWN'));
  const shortened={ends_at:'2035-01-06T03:00:00.000Z'};
  const bad=f.preview([f.change('placements',ids.stay.placement,'upsert_placement',{data:shortened})]);assert.equal(bad.preview.can_apply,false);
  const request=f.preview([f.change('placements',ids.stay.placement,'request_reschedule',{data:shortened,reason:'Leave a day earlier'})]);
  assert.equal(request.preview.can_apply,true);assert.equal(request.preview.allowed_acknowledgements.length,2);f.apply(request);
  assert.equal(f.sources().services.filter(s=>s.state==='confirmed').length,2);
  assert.equal(f.sources().services.filter(s=>s.state==='confirmed').map(s=>s.date_end).sort().at(-1),'2035-01-07');
});

test('group stale preview covers phantom neighbours and atomic SQL failure restores all slots, deadlines and receipts',async t=>{
  const f=await fixture(t),ids=chain(f),move=()=>f.change('placements',ids.walk.placement,'apply_group_shift',{data:{starts_at:time('07:00'),direction:'forward'}});
  const old=f.preview([move()]);f.write([{key:'phantom',type:'create_item',data:{kind:'visit',title:'New unscheduled item'}}]);assert.throws(()=>f.apply(old),code('PREVIEW_STALE'));
  const p=f.preview([move()]),before=fingerprint(f.sources());
  run(f.db,"CREATE TRIGGER reject_shift BEFORE UPDATE ON planning_placements WHEN NEW.id='"+ids.coffee.placement+"' BEGIN SELECT RAISE(ABORT,'test shift failure'); END");
  assert.throws(()=>f.apply(p),/test shift failure/);assert.equal(fingerprint(f.sources()),before);
  assert.equal(one(f.db,'SELECT count(*) n FROM planning_operations WHERE changeset_id=?',p.id).n,0);run(f.db,'DROP TRIGGER reject_shift');f.apply(p);
  assert.deepEqual(all(f.db,'PRAGMA foreign_key_check'),[]);
});

test('viewer evaluate is read-only, edits need membership and HTTP returns the same group preview contract',async t=>{
  const f=await fixture(t),ids=chain(f),commands=[f.change('placements',ids.walk.placement,'apply_group_shift',{data:{starts_at:time('07:00'),direction:'forward'}})],before=fingerprint(f.sources());
  const result=evaluatePlanning(f.db,f.viewer,{version:3,commands},NOW);assert.equal(result.can_apply,true);assert.equal(result.groups[0].changes.length,3);assert.equal(fingerprint(f.sources()),before);
  assert.throws(()=>f.preview(commands,NOW,f.viewer),code('PLANNING_ACCESS_DENIED'));
  const response=await f.call('/api/planning/evaluate','POST',{version:3,commands});assert.equal(response.status,200);assert.equal((await response.json()).groups[0].changes.length,3);
  const p=f.preview(commands);run(f.db,"UPDATE memberships SET role='viewer' WHERE user_id='editor'");assert.throws(()=>f.apply(p),code('PLANNING_ACCESS_DENIED'));
});

test('distance uses chosen locations before candidates, skips reference/deleted points, and transport uses the correct ends',async t=>{
  const f=await fixture(t),places=f.sources().places,other=places.find(p=>p.id!=='taipei-101').id;
  const ids=f.write([...visit('a','06:00','07:00'),...visit('train','08:00','12:00',{kind:'transport'}),...visit('b','13:00','14:00',{point:other})]);
  f.write([{key:'arrival',type:'link_place',placement_id:ids.train.placement,expected_version:0,data:{place_id:other,role:'arrival'}}]);
  run(f.db,"UPDATE places SET lat=0,lon=0 WHERE id='taipei-101'");run(f.db,'UPDATE places SET lat=0,lon=2 WHERE id=?',other);
  const s=f.sources(),a=s.placements.find(p=>p.id===ids.a.placement),train=s.placements.find(p=>p.id===ids.train.placement),b=s.placements.find(p=>p.id===ids.b.placement);
  assert.equal(transition(s,a,train,NOW).distance_m,0);assert.equal(transition(s,train,b,NOW).distance_m,0);
  assert.equal(transition(s,a,b,NOW).status,'unresolved_long_transfer');
  s.placement_places.push({...s.placement_places.find(l=>l.placement_id===b.id),id:'closer',place_id:'taipei-101',selection:'candidate'});
  assert(transition(s,a,b,NOW).distance_m>100000); // A candidate cannot override an already chosen destination.
  s.placement_places.find(l=>l.placement_id===b.id&&l.id!=='closer').selection='candidate';
  const min=transition(s,a,b,NOW);assert.equal(min.distance_m,0);assert.equal(min.candidates,true);
  s.placement_places.push({id:'missing',placement_id:b.id,place_id:null,role:'visit',selection:'candidate',archived_at:null});assert.equal(transition(s,a,b,NOW).incomplete_points,true);
  s.placement_places.find(l=>l.id==='closer').role='reference';assert(transition(s,a,b,NOW).distance_m>100000);
  const ordered=transitionContext(s,a,b);s.placement_places.reverse();s.places.reverse();assert.equal(transitionContext(s,a,b),ordered);
});

test('explicit transport duration is not replaced by the distance policy and manual travel may exceed three hours',async t=>{
  const f=await fixture(t),other=f.sources().places.find(p=>p.id!=='taipei-101').id;
  run(f.db,"UPDATE places SET lat=0,lon=0 WHERE id='taipei-101'");run(f.db,'UPDATE places SET lat=0,lon=2 WHERE id=?',other);
  const ids=f.write([...visit('a','01:00','02:00'),...visit('train','03:00','08:00',{kind:'transport'}),...visit('b','09:00','10:00',{point:other})]);
  f.write([{key:'arrival',type:'link_place',placement_id:ids.train.placement,expected_version:0,data:{place_id:other,role:'arrival'}}]);
  const p=f.preview([f.change('placements',ids.a.placement,'apply_group_shift',{data:{starts_at:time('02:30'),direction:'forward'}})]);
  assert.equal(p.preview.can_apply,true);const train=p.preview.changes.find(c=>c.collection==='placements'&&c.id===ids.train.placement).after;
  assert.equal(Date.parse(train.ends_at)-Date.parse(train.starts_at),5*3600000);
  const manual=f.write([link('manual','set_transition_override',{from_placement_id:ids.a.placement,to_placement_id:ids.b.placement},{mode:'manual',minutes:300,route_checked:true})]);
  const s=f.sources(),gap=transition(s,s.placements.find(p=>p.id===ids.a.placement),s.placements.find(p=>p.id===ids.b.placement),NOW);
  assert.equal(gap.required_minutes,300);assert.equal(gap.approximate,false);assert.equal(gap.override_id,manual.manual.link);
});

test('group crosses midnight in endpoint-local zones and updates relative targets and unsent reminders once',async t=>{
  const f=await fixture(t),ids=f.write([...visit('a','14:00','15:00'),...visit('b','15:10','16:10')]);
  const prep=f.write([{key:'task',type:'create_item',data:{kind:'task',title:'Prepare'}},link('target','set_deadline',{}, {task_id:ref('task','item'),mode:'relative',timezone:TZ}),link('rule','set_deadline_rule',{task_id:ref('task','item'),anchor_placement_id:ids.b.placement},{offset_minutes:-120,rule_timezone:TZ})]);
  run(f.db,"INSERT INTO planning_reminders(id,user_id,item_id,enabled,mode,offset_minutes,fires_at,generation,updated_at) VALUES('reminder','editor',?,1,'offset',30,?,1,1)",prep.task.item,Date.parse(time('12:40')));
  const p=f.preview([f.change('placements',ids.a.placement,'apply_group_shift',{data:{starts_at:time('15:00'),direction:'forward'}})]);
  assert.equal(p.preview.can_apply,true);assert(p.preview.reminder_impact.mine.some(r=>r.id==='reminder'));f.apply(p);
  assert.equal(f.row('placements',ids.b.placement).date_start,'2035-01-05');assert.equal(f.row('placements',ids.b.placement).starts_at,time('16:10'));
  assert.equal(f.row('deadlines',prep.target.link).at,time('14:10'));
  assert.equal(one(f.db,"SELECT fires_at FROM planning_reminders WHERE id='reminder'").fires_at,Date.parse(time('13:40')));
  assert.equal(one(f.db,"SELECT generation FROM planning_reminders WHERE id='reminder'").generation,2);
});

test('new neighbours invalidate the original gap: a single move checks both new sides and no row-index override transfers',async t=>{
  const f=await fixture(t),ids=f.write([...visit('a','06:00','07:00'),...visit('b','08:00','09:00'),...visit('c','10:00','11:00')]);
  const override=f.write([link('off','set_transition_override',{from_placement_id:ids.a.placement,to_placement_id:ids.b.placement},{mode:'disabled',note:'Same venue'})]);
  const p=f.preview([f.change('placements',ids.c.placement,'upsert_placement',{data:{starts_at:time('07:00'),ends_at:time('08:00')}})]);
  assert.equal(p.preview.can_apply,true);
  const gaps=p.preview.derived.schedule.transitions;assert.deepEqual(gaps.map(g=>g.mode),['auto','auto']);assert(gaps.every(g=>g.shortfall_minutes===10));
  f.apply(p);assert.equal(f.row('transition_overrides',override.off.link).archived_at,null);
});

test('a chosen buffer is maxed with logical precedence; distinct entry/exit requirements remain and are not doubled',async t=>{
  const f=await fixture(t),ids=f.write([...visit('a','06:00','07:00'),...visit('b','10:30','11:30')]),book=f.write(ticket(ids.b.placement,{lead:15}));
  f.write([link('minimum','set_time_link',{from_placement_id:ids.a.placement,to_placement_id:ids.b.placement},{minimum_minutes:30}),link('buffer','set_transition_override',{from_placement_id:ids.a.placement,to_placement_id:ids.b.placement},{mode:'manual',minutes:20})]);
  assert.equal(f.model().derived.schedule.transitions[0].required_minutes,35);
  f.write([{key:'n',type:'create_need',data:{kind:'admission',label:'Another need',required_units:1,unit_type:'person'}},link('nt','set_need_target',{need_id:ref('n','need'),placement_id:ids.b.placement},{}),link('ns','set_need_service',{need_id:ref('n','need'),service_id:book.service.service},{})]);
  assert.equal(f.model().derived.schedule.transitions[0].required_minutes,35); // Same source is not counted twice.
});

test('service-bound override captures final source version and expires on a later supplier amendment',async t=>{
  const f=await fixture(t),ids=f.write([...visit('a','06:00','07:00'),...visit('b','10:30','11:30')]),book=f.write(ticket(ids.b.placement));
  const changes=[f.change('services',book.service.service,'correct_service',{data:{title:'Gate changed'},reason:'Supplier update'}),link('manual','set_transition_override',{from_placement_id:ids.a.placement,to_placement_id:ids.b.placement},{mode:'manual',minutes:45,service_id:book.service.service})];
  const result=f.write(changes);assert.equal(f.model().derived.schedule.transitions[0].mode,'manual');
  assert.equal(f.row('transition_overrides',result.manual.link).source_service_version,f.row('services',book.service.service).version);
  f.write([f.change('services',book.service.service,'correct_service',{data:{starts_at:time('11:00')},reason:'Entry changed'})]);
  assert.equal(f.model().derived.schedule.transitions[0].mode,'auto');
});

test('held expiry and changed conditions invalidate acknowledgements without writing a stale group',async t=>{
  const f=await fixture(t),ids=f.write(visit('tower','10:30','11:30')),book=f.write(ticket(ids.tower.placement,{state:'held',extra:{hold_expires_at:NOW+30000}}));
  const p=f.preview([f.change('placements',ids.tower.placement,'request_reschedule',{data:{starts_at:time('11:00')},reason:'Later'})]);
  assert.equal(p.expires_at,NOW+30000);assert.throws(()=>f.apply(p,{now:NOW+30000}),code('PREVIEW_STALE'));
  f.write([f.change('services',book.service.service,'correct_service',{data:{title:'More conditions'},reason:'Supplier corrected'})]);
  assert.throws(()=>f.apply(p),code('PREVIEW_STALE'));
  assert.equal(f.sources().reschedule_requests.length,0);assert.equal(f.row('placements',ids.tower.placement).starts_at,time('10:30'));
});

test('time windows constrain duration and stop propagation, incomplete neighbours never yield an infinite safe limit',async t=>{
  const f=await fixture(t),ids=f.write([...visit('a','06:00','07:00'),...visit('b','08:00','09:00')]);
  f.write([link('window','set_time_constraint',{placement_id:ids.b.placement},{kind:'window',values:{start:time('07:30'),end:time('10:00')},reason:'Opening hours'})]);
  const p=f.preview([f.change('placements',ids.a.placement,'apply_group_shift',{data:{starts_at:time('07:00'),direction:'forward'}})]);assert.equal(p.preview.can_apply,false);assert.equal(p.preview.groups[0].boundary.placement_id,ids.b.placement);
  const limits=f.model().derived.schedule.duration_limits.find(l=>l.placement_id===ids.b.placement);assert.equal(limits.without_shift.max_minutes,120);
  const next=f.write([{key:'unknown',type:'create_item',data:{kind:'visit',title:'Partial'}},{key:'slot',type:'upsert_placement',id:ref('unknown','placement'),expected_version:1,data:{precision:'approximate',starts_at:time('09:30'),start_timezone:TZ}}]);
  const after=f.model().derived.schedule.duration_limits.find(l=>l.placement_id===ids.b.placement);assert.equal(after.without_shift.max_minutes,null);assert.equal(after.without_shift.status,'unknown');
  assert.equal(f.row('placements',next.unknown.placement).ends_at,null);
});

test('non-neighbour precedence tightens grouped duration as well as direct duration',async t=>{
  const f=await fixture(t),ids=chain(f);
  f.write([link('deadline','set_time_link',{from_placement_id:ids.walk.placement,to_placement_id:ids.tower.placement},{minimum_minutes:210})]);
  const limits=f.model().derived.schedule.duration_limits.find(l=>l.placement_id===ids.walk.placement);
  assert.equal(limits.with_shift.max_minutes,60);
  const p=f.preview([f.change('placements',ids.walk.placement,'apply_group_shift',{data:{starts_at:time('06:00'),duration_minutes:65,direction:'forward'}})]);assert.equal(p.preview.can_apply,false);
});

test('0016 applies only additive DDL to a populated model3 backup and leaves the source untouched',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'taiwan-stage3-')),folder=join(directory,'migrations');mkdirSync(folder);
  for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')&&n<'0016'))copyFileSync(join('drizzle',name),join(folder,name));
  const db=openDatabase(join(directory,'source.sqlite'));migrate(db,folder);await seed(db);
  run(db,"INSERT INTO users(id,display_name,created_at) VALUES('editor','Editor',1)");run(db,"INSERT INTO memberships VALUES(?,'editor','editor')",TRIP);
  await applyPlanningChange(db,{id:'editor',role:'editor'},{path:'/api/planning/items',method:'POST',creationId:'legacy-hotel',body:{kind:'stay',title:'Confirmed hotel',note:'Keep note',date_start:'2035-01-04',date_end:'2035-01-07',places:[{place_id:'taipei-101',role:'lodging'}]}});
  upgradePlanningModel(db,{id:'editor'},NOW);
  const tables=all(db,"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_app_migrations'").map(t=>t.name),columns=Object.fromEntries(tables.map(name=>[name,all(db,'PRAGMA table_info('+name+')').map(c=>c.name)]));
  const snapshot=database=>Object.fromEntries(tables.map(name=>[name,all(database,'SELECT '+columns[name].join(',')+' FROM '+name+' ORDER BY rowid')]));
  const before=snapshot(db);await backup(db.sqlite,join(directory,'copy.sqlite'));
  const copy=openDatabase(join(directory,'copy.sqlite'));t.after(()=>{copy.close();db.close();rmSync(directory,{recursive:true,force:true});});migrate(copy,'drizzle');
  assert.deepEqual(snapshot(copy),before);assert.deepEqual(snapshot(db),before);assert.deepEqual(all(copy,'PRAGMA foreign_key_check'),[]);assert.equal(one(copy,'PRAGMA integrity_check').integrity_check,'ok');
  assert.equal(one(copy,"SELECT count(*) n FROM pragma_table_info('planning_placements') WHERE name='approved_context_json'").n,1);
  assert.equal(one(copy,'SELECT count(*) n FROM planning_placements').n,1);assert.equal(one(copy,'SELECT approved_context_json FROM planning_placements').approved_context_json,null);
  assert.equal(one(copy,'SELECT count(*) n FROM booking_services').n,1);
  assert.equal(one(db,"SELECT count(*) n FROM _app_migrations WHERE name LIKE '0016%'").n,0);
  migrate(copy,'drizzle');assert.deepEqual(snapshot(copy),before);
});

test('date-only uncertainty in another timezone cannot disappear across a local calendar boundary',async t=>{
  const f=await fixture(t),ids=chain(f);
  f.write([{key:'unknown',type:'create_item',data:{kind:'visit',title:'West coast time unknown'}},{key:'day',type:'upsert_placement',id:ref('unknown','placement'),expected_version:1,data:{precision:'day',date_start:'2035-01-03',start_timezone:'America/Los_Angeles'}}]);
  const p=f.preview([f.change('placements',ids.walk.placement,'apply_group_shift',{data:{starts_at:time('07:00'),direction:'forward'}})]);
  assert.equal(p.preview.can_apply,false);assert(p.preview.issues.some(i=>i.code==='GROUP_ORDER_INCOMPLETE'));
});
