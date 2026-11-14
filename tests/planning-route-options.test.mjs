import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase,migrate } from '../server/database.mjs';
import { seed } from '../src/seed.mjs';
import { TRIP,sha } from '../src/auth.mjs';
import { run,all,one } from '../src/sqlite.mjs';
import { upgradePlanningModel } from '../src/planning-upgrade.mjs';
import { readSources,fingerprint } from '../src/planning-domain-store.mjs';
import { readModel3,createChangeset,previewChangeset,applyChangeset,evaluatePlanning } from '../src/planning-command-service.mjs';
import { planningData,readItem } from '../src/planning-store.mjs';
import { handle } from '../src/core.mjs';
import { applicablePlanningIds } from '../src/planning-applicability.mjs';
import { bookingRegistry } from '../src/planning-bookings.mjs';
import { applyPlanningChange } from '../src/planning.mjs';
import { mkdtempSync,readdirSync,copyFileSync,mkdirSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backup } from 'node:sqlite';

const NOW=Date.parse('2030-01-01T00:00:00Z'),TZ='Asia/Taipei',time=(day,h)=>`2035-01-${day}T${h}:00.000Z`;
const ref=(command,entity)=>({command,entity}),code=c=>e=>e.details?.code===c;
const link=(key,type,refs,data={})=>({key,type,expected_version:0,...refs,data});
async function fixture(t){
  const db=openDatabase();migrate(db,'drizzle');await seed(db);t.after(()=>db.close());run(db,"INSERT INTO app_meta(key,value) VALUES('accounts_v1','shared')");
  for(const [id,role] of [['editor','editor'],['viewer','viewer']]){run(db,'INSERT INTO users(id,display_name,created_at) VALUES(?,?,1)',id,id);run(db,'INSERT INTO memberships VALUES(?,?,?)',TRIP,id,role);}
  const user={id:'editor',role:'editor'},viewer={id:'viewer',role:'viewer'};upgradePlanningModel(db,user,NOW);
  const sources=()=>readSources(db).sources,row=(c,id)=>sources()[c].find(x=>x.id===id),model=()=>readModel3(db,user,NOW);
  const preview=(commands,actor=user,now=NOW)=>{const d=createChangeset(db,actor,{version:3,commands},now);return previewChangeset(db,actor,d.id,{version:d.version},now);};
  const apply=(p,{ack=p.preview.allowed_acknowledgements,actor=user,now=NOW}={})=>applyChangeset(db,actor,p.id,{version:p.version,fingerprint:p.preview.fingerprint,idempotency_key:'apply-'+p.id,acknowledgements:ack},now);
  const write=commands=>{const p=preview(commands);assert.equal(p.preview.can_apply,true,JSON.stringify(p.preview.issues.filter(i=>i.blocking)));apply(p);return p.preview.resolved_ids;};
  const change=(c,id,type,more={})=>({key:'change',type,id,expected_version:row(c,id).version,...more});
  const choose=(d,o,key='choose')=>change('decisions',d,'choose_working',{key,option_id:o});
  const compare=(choices,actor=viewer)=>evaluatePlanning(db,actor,{version:3,choices},NOW);
  const token='4'.repeat(64);run(db,'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',await sha(token),user.id,Date.now()+86400000);
  const call=(path,method='GET',data)=>handle(new Request('https://example.test'+path,{method,headers:{Authorization:'Bearer '+token,Origin:'https://example.test','Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})}),{DB:db,APP_ORIGIN:'https://example.test',AUTH_MODE:'bearer'});
  return {db,user,viewer,sources,row,model,preview,apply,write,change,choose,compare,call};
}
function decision(key='route',scope){return [{key,type:'create_decision',...(scope?{scope_id:scope}:{}),data:{title:'When to move',note:'One decision note'}},
  {key:key+'normal',type:'add_option',decision_id:ref(key,'decision'),expected_version:1,data:{label:'Move on Jan 7'}},
  {key:key+'early',type:'add_option',decision_id:ref(key,'decision'),expected_version:1,data:{label:'Move one day earlier'}}];}
function visit(key,day='07',start='05:00',end='06:00',scope){return [
  {key,type:'create_item',...(scope?{scope_id:scope}:{}),data:{kind:'visit',title:key,note:'Shared note '+key}},
  {key:key+'slot',type:'upsert_placement',id:ref(key,'placement'),expected_version:1,data:{precision:'exact',starts_at:time(day,start),ends_at:time(day,end),start_timezone:TZ,end_timezone:TZ}},
  {key:key+'place',type:'link_place',placement_id:ref(key,'placement'),expected_version:0,data:{role:'visit',place_id:'taipei-101'}}];}
function adopt(f,item,placement,d,option){return f.change('items',item,'reassign_route_owner',{decision_id:d,mappings:[{placement_id:placement,option_id:option}],reason:'Make route alternatives'});}
function scenario(f,{booked=true}={}){
  const ids=f.write([
    {key:'hotel',type:'create_item',data:{kind:'stay',title:'Taipei hotel',note:'Keep hotel note'}},
    {key:'hotelSlot',type:'upsert_placement',id:ref('hotel','placement'),expected_version:1,data:{precision:'day',date_start:'2035-01-04',date_end:'2035-01-07',start_timezone:TZ,end_timezone:TZ}},
    {key:'hotelPlace',type:'link_place',placement_id:ref('hotel','placement'),expected_version:0,data:{role:'lodging',place_id:'taipei-101'}},
    {key:'train',type:'create_item',data:{kind:'transport',title:'Train to another city',note:'Keep train note'}},
    {key:'trainSlot',type:'upsert_placement',id:ref('train','placement'),expected_version:1,data:{precision:'exact',starts_at:time('07','01:00'),ends_at:time('07','02:00'),start_timezone:TZ,end_timezone:TZ}},
    ...['departure','arrival'].map(role=>({key:role,type:'link_place',placement_id:ref('train','placement'),expected_version:0,data:{role,place_id:'taipei-101'}})),
    ...['hotel','train'].flatMap(key=>[{key:key+'Need',type:'create_need',data:{kind:key==='hotel'?'accommodation':'transport',label:'Book '+key,required_units:1,unit_type:key==='hotel'?'room':'person'}},link(key+'Target','set_need_target',{need_id:ref(key+'Need','need'),placement_id:ref(key,'placement')}),{key:key+'Prep',type:'ensure_preparation',need_id:ref(key+'Need','need'),expected_version:1}])
  ]);
  if(booked){const facts=f.write(['hotel','train'].flatMap(key=>[
    {key:key+'Booking',type:'record_booking',data:{category:key==='hotel'?'lodging':'rail',reference:'Keep reference'}},
    {key:key+'Service',type:'add_service',booking_id:ref(key+'Booking','booking'),data:{kind:key==='hotel'?'stay':'transport',state:'confirmed',title:'Actual '+key,validity:key==='hotel'?'date_range':'exact_interval',...(key==='hotel'?{date_start:'2035-01-04',date_end:'2035-01-07'}:{starts_at:time('07','01:00'),ends_at:time('07','02:00')}),start_timezone:TZ,end_timezone:TZ,capacity_units:1,unit_type:key==='hotel'?'room':'person'}},
    ...(key==='hotel'?['lodging']:['departure','arrival']).map(role=>link(key+role,'set_service_place',{service_id:ref(key+'Service','service')},{role,place_id:'taipei-101'})),
    link(key+'Allocation','set_need_service',{need_id:ids[key+'Need'].need,service_id:ref(key+'Service','service')}),
    f.change('items',ids[key+'Prep'].item,'set_task_state',{key:key+'Done',state:'done'})
  ]));Object.assign(ids,facts);}
  const d=f.write(decision());Object.assign(ids,d);
  f.write(['hotel','train'].map(key=>({...adopt(f,ids[key].item,ids[key].placement,d.route.decision,d.routenormal.option),key:key+'Owner'})).concat(f.choose(d.route.decision,d.routenormal.option)));
  const variants=f.write(['hotel','train'].flatMap(key=>[
    {key:key+'Early',type:'add_variant_placement',item_id:ids[key].item,option_id:d.routeearly.option,expected_version:f.row('items',ids[key].item).version,source_placement_id:ids[key].placement},
    {key:key+'Earlier',type:'upsert_placement',id:ref(key+'Early','placement'),expected_version:1,data:key==='hotel'?{date_end:'2035-01-06'}:{starts_at:time('06','01:00'),ends_at:time('06','02:00')}}
  ]));Object.assign(ids,variants);return ids;
}

test('route options use shared item identities and comparison is read-only across the whole multi-day section',async t=>{
  const f=await fixture(t),ids=scenario(f),before=fingerprint(f.sources());
  const view=f.compare([{decision_id:ids.route.decision,option_id:ids.routeearly.option}]);
  assert.equal(view.context,'comparison');assert.equal(fingerprint(f.sources()),before);assert.equal(view.viewed.choices[0].working_option_id,ids.routeearly.option);
  assert.equal(view.working.choices[0].working_option_id,ids.routenormal.option);assert.equal(view.route_impact.items.length,2);
  assert.deepEqual(view.route_impact.bookings.find(b=>b.service_id===ids.hotelService.service).lost_nights,['2035-01-06']);
  assert.equal(f.sources().items.filter(i=>i.kind==='stay').length,1);assert.equal(f.row('items',ids.hotel.item).note,'Keep hotel note');
  assert.equal(view.derived.schedule.issues.filter(i=>i.code==='STAY_NIGHT_OVERLAP').length,0);
  assert.equal(view.derived.needs.find(n=>n.id===ids.trainNeed.need).status,'mismatch');
});

test('reopen and switch keep actual tickets, partial hotel obligations and completed purchases; returning rereads cancellations',async t=>{
  const f=await fixture(t),ids=scenario(f);f.write([f.change('decisions',ids.route.decision,'accept_decision')]);
  assert.throws(()=>f.preview([f.choose(ids.route.decision,ids.routeearly.option)]),code('REOPEN_REQUIRED'));
  const p=f.preview([f.change('decisions',ids.route.decision,'reopen_decision',{key:'reopen',reason:'Leave earlier'}),f.choose(ids.route.decision,ids.routeearly.option)]);
  assert.equal(p.preview.can_apply,true);assert(p.preview.allowed_acknowledgements.length>=2);assert.throws(()=>f.apply(p,{ack:[]}),code('ACKNOWLEDGEMENTS_REQUIRED'));
  const receipt=f.apply(p);assert.deepEqual(f.apply(p),receipt);
  assert.equal(f.row('services',ids.trainService.service).starts_at,time('07','01:00'));assert.equal(f.row('services',ids.hotelService.service).date_end,'2035-01-07');
  assert.equal(f.row('items',ids.train.item).date_start,'2035-01-06');assert.equal(f.row('items',ids.trainPrep.item).state,'done');
  assert.equal(f.row('decisions',ids.route.decision).accepted_option_id,ids.routenormal.option);assert.equal(f.row('decisions',ids.route.decision).resolution,'review');
  assert.equal(readItem(f.db,f.row('items',ids.train.item)).places.length,2);
  f.write([f.change('services',ids.trainService.service,'set_service_state',{state:'cancelled',reason:'Supplier cancelled'})]);
  f.write([f.choose(ids.route.decision,ids.routenormal.option)]);
  assert.equal(f.model().derived.needs.find(n=>n.id===ids.trainNeed.need).status,'missing');assert.equal(f.row('items',ids.trainPrep.item).state,'done');
});

test('accepted active placement edits require review, adding and editing an unselected option do not reset the choice',async t=>{
  const f=await fixture(t),ids=scenario(f,{booked:false});f.write([f.change('decisions',ids.route.decision,'accept_decision')]);
  assert.throws(()=>f.preview([f.change('placements',ids.train.placement,'upsert_placement',{data:{ends_at:time('07','03:00')}})]),code('REOPEN_REQUIRED'));
  f.write([f.change('placements',ids.trainEarly.placement,'upsert_placement',{data:{ends_at:time('06','03:00')}})]);
  f.write([{key:'new',type:'add_option',decision_id:ids.route.decision,expected_version:f.row('decisions',ids.route.decision).version,data:{label:'Skip transfer'}}]);
  assert.equal(f.row('decisions',ids.route.decision).resolution,'accepted');assert.equal(f.row('decisions',ids.route.decision).working_option_id,ids.routenormal.option);
});

test('nested decisions become dormant and return with their own accepted choice; a third level is an explicit limitation',async t=>{
  const f=await fixture(t),outer=f.write(decision()),inner=f.write(decision('hotel',outer.routeearly.scope));
  f.write([f.choose(outer.route.decision,outer.routeearly.option)]);
  f.write([f.choose(inner.hotel.decision,inner.hotelnormal.option),f.change('decisions',inner.hotel.decision,'accept_decision',{key:'accept'})]);
  f.write([f.choose(outer.route.decision,outer.routenormal.option)]);
  assert.equal(f.model().working.decisions.find(d=>d.id===inner.hotel.decision).active,false);
  f.write([f.choose(outer.route.decision,outer.routeearly.option)]);assert.equal(f.model().working.decisions.find(d=>d.id===inner.hotel.decision).active,true);
  f.write([f.choose(outer.route.decision,outer.routenormal.option)]);assert.equal(f.row('decisions',inner.hotel.decision).resolution,'accepted');
  f.write([f.choose(outer.route.decision,outer.routeearly.option)]);assert.equal(f.row('decisions',inner.hotel.decision).working_option_id,inner.hotelnormal.option);
  const bad=createChangeset(f.db,f.user,{version:3,commands:decision('tooDeep',inner.hotelnormal.scope)},NOW);
  assert.throws(()=>previewChangeset(f.db,f.user,bad.id,{version:bad.version},NOW),e=>code('UNSUPPORTED_NESTING')(e)&&e.details.refs.length>0);
  assert.equal(one(f.db,'SELECT status FROM planning_changesets WHERE id=?',bad.id).status,'draft');
});

test('explicit requires/excludes conditions are recalculated by ID; unresolved choices cannot be accepted and cycles cannot be written',async t=>{
  const f=await fixture(t),a=f.write(decision('a')),b=f.write(decision('b'));
  f.write([{key:'rule',type:'set_option_constraint',expected_version:0,option_id:a.aearly.option,other_option_id:b.bnormal.option,relation:'requires_option'},f.choose(a.a.decision,a.aearly.option)]);
  assert(f.model().derived.route.issues.some(i=>i.code==='OPTION_REQUIREMENT_UNRESOLVED'));
  let p=f.preview([f.change('decisions',a.a.decision,'accept_decision')]);assert.equal(p.preview.can_apply,false);
  f.write([f.choose(b.b.decision,b.bearly.option)]);assert(f.model().derived.route.issues.some(i=>i.code==='OPTION_COMBINATION_CONFLICT'));
  f.write([f.choose(b.b.decision,b.bnormal.option),f.change('decisions',a.a.decision,'accept_decision',{key:'accept'})]);
  f.write([f.change('options',b.bnormal.option,'edit_option',{data:{label:'Renamed transport choice'}})]);assert.equal(f.model().derived.route.issues.length,0);
  assert.throws(()=>f.preview([{key:'cycle',type:'set_option_constraint',expected_version:0,option_id:b.bnormal.option,other_option_id:a.aearly.option,relation:'requires_option'}]),code('DEPENDENCY_CYCLE'));
  f.write([{key:'exclude',type:'set_option_constraint',expected_version:0,option_id:b.bnormal.option,other_option_id:a.anormal.option,relation:'excludes_option'}]);
  const view=f.compare([{decision_id:a.a.decision,option_id:a.anormal.option}]);assert(view.derived.route.issues.some(i=>i.code==='OPTION_COMBINATION_CONFLICT'&&i.refs.some(r=>r.id===a.anormal.option)));
});

test('two independent decisions cannot own the same route item and ownership transfer requires complete mapping',async t=>{
  const f=await fixture(t),a=f.write(decision('a')),b=f.write(decision('b')),v=f.write(visit('v'));
  f.write([adopt(f,v.v.item,v.v.placement,a.a.decision,a.anormal.option),f.choose(a.a.decision,a.anormal.option)]);
  assert.throws(()=>f.preview([{key:'bad',type:'add_variant_placement',item_id:v.v.item,option_id:b.bnormal.option,expected_version:f.row('items',v.v.item).version}]),e=>code('MULTIPLE_PLACEMENT_OWNERS')(e)&&e.details.refs.some(r=>r.id===v.v.item));
  const second=f.write([{key:'second',type:'add_variant_placement',item_id:v.v.item,option_id:a.aearly.option,expected_version:f.row('items',v.v.item).version,source_placement_id:v.v.placement}]);
  assert.throws(()=>f.preview([adopt(f,v.v.item,v.v.placement,b.b.decision,b.bnormal.option)]),code('INCOMPLETE_OWNER_MAPPING'));
  f.write([f.change('items',v.v.item,'reassign_route_owner',{decision_id:b.b.decision,mappings:[{placement_id:v.v.placement,option_id:b.bnormal.option},{placement_id:second.second.placement,option_id:b.bearly.option}],reason:'Combine changes under B'}),f.choose(b.b.decision,b.bnormal.option)]);
  assert.equal(f.row('items',v.v.item).route_owner_decision_id,b.b.decision);assert.equal(f.sources().items.filter(i=>i.kind==='visit').length,1);
});

test('decision results and prerequisites require acceptance, while reopening preserves completed work and reports the changed prerequisite',async t=>{
  const f=await fixture(t),d=f.write(decision()),v=f.write(visit('v'));
  const ids=f.write([{key:'need',type:'create_need',data:{kind:'decision_result',label:'Choose travel day'}},link('target','set_need_target',{need_id:ref('need','need'),placement_id:v.v.placement}),{key:'result',type:'set_decision_result',expected_version:0,need_id:ref('need','need'),decision_id:d.route.decision,required_option_id:d.routeearly.option},
    {key:'task',type:'create_item',data:{kind:'task',title:'Prepare selected route'}},{key:'prereq',type:'set_decision_prerequisite',expected_version:0,task_id:ref('task','item'),decision_id:d.route.decision,required_option_id:d.routeearly.option},f.choose(d.route.decision,d.routeearly.option)]);
  assert.equal(f.model().derived.needs.find(n=>n.id===ids.need.need).status,'missing');
  assert.throws(()=>f.preview([f.change('items',ids.task.item,'set_task_state',{state:'done'})]),code('TASK_PREREQUISITE_BLOCKED'));
  f.write([f.change('decisions',d.route.decision,'accept_decision'),f.change('items',ids.task.item,'set_task_state',{key:'done',state:'done'})]);assert.equal(f.model().derived.needs.find(n=>n.id===ids.need.need).status,'satisfied');
  f.write([f.change('decisions',d.route.decision,'reopen_decision',{reason:'Review choice'})]);assert.equal(f.row('items',ids.task.item).state,'done');assert(f.model().derived.issues.some(i=>i.code==='COMPLETED_TASK_PREREQUISITE_CHANGED'));
});

test('shared preparation stays applicable for either option; service reconciliation survives no choice',async t=>{
  const f=await fixture(t),ids=scenario(f,{booked:false}),task=ids.trainPrep.item;
  assert.equal(f.model().derived.tasks.find(t=>t.id===task).applicable,true);
  f.write([f.choose(ids.route.decision,ids.routeearly.option)]);assert.equal(f.model().derived.tasks.find(t=>t.id===task).applicable,true);
  f.write([f.change('decisions',ids.route.decision,'clear_working',{mode:'exclude_segment',reason:'Neither route works'})]);
  assert.equal(f.model().derived.tasks.find(t=>t.id===task).applicable,false);assert.equal(applicablePlanningIds(f.db).has(task),false);
  const work=f.write([{key:'booking',type:'record_booking',data:{}},{key:'service',type:'add_service',booking_id:ref('booking','booking'),data:{kind:'transport',state:'confirmed',title:'Actual unknown itinerary'}},{key:'review',type:'create_item',scope_id:ids.routeearly.scope,data:{kind:'task',title:'Review actual booking'}},link('reconcile','set_service_task',{service_id:ref('service','service'),task_id:ref('review','item')},{action:'review'})]);
  assert.equal(f.model().derived.tasks.find(t=>t.id===work.review.item).applicable,true);assert.equal(applicablePlanningIds(f.db).has(work.review.item),true);
  assert.equal(f.sources().items.filter(t=>t.id===task).length,1);
});

test('relative target uses active alternative anchors and refreshes unsent reminders without rearming sent generations',async t=>{
  const f=await fixture(t),ids=scenario(f,{booked:false}),task=ids.trainPrep.item;
  const targets=f.write([link('deadline','set_deadline',{}, {task_id:task,mode:'relative',timezone:TZ}),
    ...[ids.train.placement,ids.trainEarly.placement].map((p,i)=>link('anchor'+i,'set_deadline_rule',{task_id:task,anchor_placement_id:p},{offset_days:-1,rule_timezone:TZ}))]);
  assert.equal(f.row('deadlines',targets.deadline.link).at,time('06','01:00'));
  for(const [id,user,sent] of [['mine','editor',null],['sent','viewer',1]])run(f.db,'INSERT INTO planning_reminders(id,user_id,item_id,enabled,mode,offset_minutes,fires_at,generation,sent_generation,updated_at) VALUES(?,?,?,1,\'offset\',30,?,1,?,1)',id,user,task,Date.parse(time('06','00:30')),sent);
  const p=f.preview([f.choose(ids.route.decision,ids.routeearly.option)]);assert(p.preview.reminder_impact.mine.some(r=>r.id==='mine'));f.apply(p);
  assert.equal(f.row('deadlines',targets.deadline.link).at,time('05','01:00'));assert.equal(one(f.db,"SELECT generation FROM planning_reminders WHERE id='mine'").generation,2);
  assert.equal(one(f.db,"SELECT sent_generation FROM planning_reminders WHERE id='sent'").sent_generation,1);
  f.write([f.change('items',task,'set_task_state',{state:'done'})]);
  f.write([f.choose(ids.route.decision,ids.routenormal.option)]);assert.equal(f.row('deadlines',targets.deadline.link).at,time('05','01:00'));
});

test('explicit no-choice gap blocks automated passage without inventing time; exclusion and choosing again have different effects',async t=>{
  const f=await fixture(t),d=f.write(decision()),v=f.write(visit('free','07','05:00','06:00'));
  assert.equal(f.model().working.gaps.length,1);assert.equal(f.model().derived.schedule.status,'incomplete');
  let p=f.preview([f.change('placements',v.free.placement,'apply_group_shift',{data:{starts_at:time('07','05:30'),direction:'forward'}})]);
  assert.equal(p.preview.can_apply,false);assert(p.preview.issues.some(i=>i.code==='GROUP_ROUTE_GAP'));
  f.write([f.change('decisions',d.route.decision,'clear_working',{mode:'retain_placeholder',data:{label:'Undecided transfer',date_start:'2035-01-07',date_end:'2035-01-08'},reason:'Need another route'})]);
  assert.equal(f.sources().placements.length,1);assert.equal(f.model().working.gaps[0].label,'Undecided transfer');
  f.write([f.change('decisions',d.route.decision,'clear_working',{mode:'exclude_segment',reason:'Skip this section'})]);
  p=f.preview([f.change('placements',v.free.placement,'apply_group_shift',{data:{starts_at:time('07','05:30'),direction:'forward'}})]);assert.equal(p.preview.can_apply,true);
  f.write([f.choose(d.route.decision,d.routenormal.option)]);assert.equal(f.model().working.gaps.length,0);assert.equal(f.row('decisions',d.route.decision).resolution,'open');
});

test('activating an approved alternative cannot introduce an approved overlap; explicit tentative intent makes the warning reviewable',async t=>{
  const f=await fixture(t),d=f.write(decision()),v=f.write([...visit('route','07','05:00','06:00'),...visit('common','07','08:00','09:00')]);
  f.write([adopt(f,v.route.item,v.route.placement,d.route.decision,d.routenormal.option),f.choose(d.route.decision,d.routenormal.option)]);
  const alt=f.write([{key:'alt',type:'add_variant_placement',item_id:v.route.item,option_id:d.routeearly.option,expected_version:f.row('items',v.route.item).version,source_placement_id:v.route.placement},{key:'slot',type:'upsert_placement',id:ref('alt','placement'),expected_version:1,data:{starts_at:time('07','08:00'),ends_at:time('07','09:00')}}]);
  f.write([f.choose(d.route.decision,d.routeearly.option),f.change('placements',alt.alt.placement,'approve_placement',{key:'approve'})]);
  f.write([f.choose(d.route.decision,d.routenormal.option),f.change('placements',v.common.placement,'approve_placement',{key:'approve'})]);
  const bad=f.preview([f.choose(d.route.decision,d.routeearly.option)]);assert.equal(bad.preview.can_apply,false);assert(bad.preview.issues.some(i=>i.code==='SCHEDULE_OVERLAP'&&i.blocking));
  const good=f.preview([f.choose(d.route.decision,d.routeearly.option),f.change('placements',alt.alt.placement,'make_tentative',{key:'tentative',reason:'Review conflict'})]);assert.equal(good.preview.can_apply,true);f.apply(good);
});

test('group propagation stops at another active scope and duration projection uses the same boundary',async t=>{
  const f=await fixture(t),d=f.write(decision()),v=f.write([...visit('inside','07','05:00','06:00',d.routenormal.scope),...visit('outside','07','06:10','07:10')]);
  f.write([f.choose(d.route.decision,d.routenormal.option)]);
  const p=f.preview([f.change('placements',v.inside.placement,'apply_group_shift',{data:{starts_at:time('07','06:00'),direction:'forward'}})]);
  assert.equal(p.preview.can_apply,false);assert(p.preview.issues.some(i=>i.code==='GROUP_SCOPE_BOUNDARY'));
  assert.equal(f.model().derived.schedule.duration_limits.find(l=>l.placement_id===v.inside.placement).with_shift.max_minutes,60);
});

test('copying an option shares items and common needs but does not clone bookings or silently move branch preparation',async t=>{
  const f=await fixture(t),ids=scenario(f),originalServices=f.sources().services.length;
  const copy=f.write([f.change('options',ids.routenormal.option,'copy_option',{data:{label:'Another draft'}})]);
  assert.equal(f.sources().services.length,originalServices);assert.equal(f.sources().items.filter(i=>i.kind==='stay').length,1);
  const p=f.sources().placements.find(p=>p.scope_id===copy.change.scope&&p.item_id===ids.hotel.item);assert(p);assert(f.sources().need_targets.some(l=>l.placement_id===p.id&&l.need_id===ids.hotelNeed.need));
  f.write([f.change('needs',ids.hotelNeed.need,'set_need_scope',{scope_id:ids.routenormal.scope})].concat(f.sources().need_targets.filter(l=>l.need_id===ids.hotelNeed.need&&l.placement_id!==ids.hotel.placement).map((l,i)=>f.change('need_targets',l.id,'remove_need_target',{key:'remove'+i}))));
  assert.throws(()=>f.preview([f.change('options',ids.routenormal.option,'copy_option',{data:{label:'Invalid blind copy'}})]),e=>code('BRANCH_PREPARATION_MAPPING_REQUIRED')(e)&&e.details.refs.some(r=>r.id===ids.hotelNeed.need));
});

test('archiving a selected option requires a replacement or explicit clear and preserves accepted history',async t=>{
  const f=await fixture(t),d=f.write(decision());f.write([f.choose(d.route.decision,d.routenormal.option),f.change('decisions',d.route.decision,'accept_decision',{key:'accept'})]);
  assert.throws(()=>f.preview([f.change('options',d.routenormal.option,'archive_option',{reason:'Old route'})]),code('WORKING_OPTION_ARCHIVED'));
  f.write([f.change('decisions',d.route.decision,'reopen_decision',{key:'reopen',reason:'New route'}),f.choose(d.route.decision,d.routeearly.option),f.change('options',d.routenormal.option,'archive_option',{key:'archive',reason:'Old route'})]);
  assert.equal(f.row('decisions',d.route.decision).accepted_option_id,d.routenormal.option);assert.equal(f.row('scopes',d.routenormal.scope).archived_at,NOW);
  f.write([f.change('options',d.routenormal.option,'restore_option',{reason:'Consider again'})]);assert.equal(f.row('scopes',d.routenormal.scope).archived_at,null);
});

test('conditions cannot require impossible parent combinations, or bind branch tasks to an incompatible required choice',async t=>{
  const f=await fixture(t),d=f.write(decision()),a=f.write(decision('a',d.routenormal.scope)),b=f.write(decision('b',d.routeearly.scope));
  assert.throws(()=>f.preview([{key:'bad',type:'set_option_constraint',expected_version:0,option_id:a.anormal.option,other_option_id:b.bnormal.option,relation:'requires_option'}]),code('OPTION_PARENT_CONFLICT'));
  const task=f.write([{key:'task',type:'create_item',scope_id:d.routenormal.scope,data:{kind:'task',title:'Only for normal'}}]);
  assert.throws(()=>f.preview([{key:'bad',type:'set_decision_prerequisite',expected_version:0,task_id:task.task.item,decision_id:d.route.decision,required_option_id:d.routeearly.option}]),code('PREREQUISITE_SCOPE_CONFLICT'));
});

test('comparison and previews enforce roles, reject wrong owners and stale decisions, and never persist a viewer choice',async t=>{
  const f=await fixture(t),a=f.write(decision()),b=f.write(decision('other')),before=fingerprint(f.sources());
  assert.throws(()=>f.preview([f.choose(a.route.decision,a.routeearly.option)],f.viewer),code('PLANNING_ACCESS_DENIED'));
  assert.throws(()=>f.compare([{decision_id:a.route.decision,option_id:b.othernormal.option}]),code('OPTION_OWNER_MISMATCH'));
  for(const body of [null,[],{version:3,choices:[],commands:[]}]){
    const invalid=await f.call('/api/planning/evaluate','POST',body);assert.equal(invalid.status,400);
  }
  const response=await f.call('/api/planning/evaluate','POST',{version:3,choices:[{decision_id:a.route.decision,option_id:a.routeearly.option}]});assert.equal(response.status,200);assert.equal((await response.json()).context,'comparison');assert.equal(fingerprint(f.sources()),before);
  const old=f.preview([f.choose(a.route.decision,a.routeearly.option)]);f.write([f.choose(b.other.decision,b.othernormal.option)]);assert.throws(()=>f.apply(old),code('PREVIEW_STALE'));
  const p=f.preview([f.choose(a.route.decision,a.routeearly.option)]);run(f.db,"UPDATE memberships SET role='viewer' WHERE user_id='editor'");assert.throws(()=>f.apply(p),code('PLANNING_ACCESS_DENIED'));
});

test('a late SQL failure rolls back the complete choice, compatibility dates, sources and operation receipt',async t=>{
  const f=await fixture(t),ids=scenario(f),p=f.preview([f.choose(ids.route.decision,ids.routeearly.option)]),before=fingerprint(f.sources());
  run(f.db,"CREATE TRIGGER reject_route BEFORE UPDATE ON planning_decisions BEGIN SELECT RAISE(ABORT,'test route failure'); END");
  assert.throws(()=>f.apply(p),/test route failure/);assert.equal(fingerprint(f.sources()),before);assert.equal(one(f.db,'SELECT count(*) n FROM planning_operations WHERE changeset_id=?',p.id).n,0);
  run(f.db,'DROP TRIGGER reject_route');f.apply(p);assert.deepEqual(all(f.db,'PRAGMA foreign_key_check'),[]);
  const events=bookingRegistry(f.db,f.user,ids.trainBooking.booking,{history:true}).events;
  assert(events.some(e=>e.payload.commands.some(c=>c.type==='choose_working')));
});

test('0017 preserves a populated stage-3 SQLite backup including legacy options, original rows and versions',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'taiwan-stage4-')),folder=join(dir,'migrations');mkdirSync(folder);
  for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')&&n<'0017'))copyFileSync(join('drizzle',name),join(folder,name));
  const db=openDatabase(join(dir,'source.sqlite'));migrate(db,folder);await seed(db);
  run(db,"INSERT INTO users(id,display_name,created_at) VALUES('editor','Editor',1)");run(db,"INSERT INTO memberships VALUES(?,'editor','editor')",TRIP);const user={id:'editor',role:'editor'};
  await applyPlanningChange(db,user,{path:'/api/planning/items',method:'POST',creationId:'old-choice',body:{kind:'decision',title:'Legacy location choice',note:'Keep decision note',options:[{id:'old-a',label:'A'},{id:'old-b',label:'B'}]}});
  await applyPlanningChange(db,user,{path:'/api/planning/items',method:'POST',creationId:'old-stay',body:{kind:'stay',title:'Confirmed hotel',date_start:'2035-01-04',date_end:'2035-01-07',places:[{place_id:'taipei-101',role:'lodging'}]}});
  upgradePlanningModel(db,user,NOW);
  const tables=all(db,"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_app_migrations'").map(t=>t.name),columns=Object.fromEntries(tables.map(name=>[name,all(db,'PRAGMA table_info('+name+')').map(c=>c.name)]));
  const snapshot=database=>Object.fromEntries(tables.map(name=>[name,all(database,'SELECT '+columns[name].join(',')+' FROM '+name+' ORDER BY rowid')]));
  const before=snapshot(db);await backup(db.sqlite,join(dir,'copy.sqlite'));const copy=openDatabase(join(dir,'copy.sqlite'));t.after(()=>{copy.close();db.close();rmSync(dir,{recursive:true,force:true});});migrate(copy,'drizzle');
  assert.deepEqual(snapshot(copy),before);assert.deepEqual(snapshot(db),before);assert.deepEqual(all(copy,'PRAGMA foreign_key_check'),[]);assert.equal(one(copy,'PRAGMA integrity_check').integrity_check,'ok');
  assert.equal(readModel3(copy,user,NOW).sources.decisions.length,0);assert.equal(one(copy,"SELECT decision_mode FROM planning_items WHERE id='old-choice'").decision_mode,'legacy_place');
  assert.equal(one(copy,'SELECT count(*) n FROM planning_options').n,2);assert.equal(one(copy,'SELECT count(*) n FROM booking_services').n,1);
  migrate(copy,'drizzle');assert.deepEqual(snapshot(copy),before);assert.equal(one(db,"SELECT count(*) n FROM _app_migrations WHERE name LIKE '0017%'").n,0);
});

test('copying an accepted option preserves shared deadline anchors and explicit precedence to common route items',async t=>{
  const f=await fixture(t),d=f.write(decision()),v=f.write([...visit('before','07','03:00','04:00'),...visit('inside','07','05:00','06:00',d.routenormal.scope),...visit('after','07','07:00','08:00')]);
  f.write([f.choose(d.route.decision,d.routenormal.option)]);
  const prep=f.write([{key:'need',type:'create_need',data:{kind:'admission',label:'Entry'}},link('needTarget','set_need_target',{need_id:ref('need','need'),placement_id:v.inside.placement}),{key:'prep',type:'ensure_preparation',need_id:ref('need','need'),expected_version:1},link('target','set_deadline',{}, {task_id:ref('prep','item'),mode:'relative',timezone:TZ}),link('rule','set_deadline_rule',{task_id:ref('prep','item'),anchor_placement_id:v.inside.placement},{offset_days:-1,rule_timezone:TZ}),
    link('in','set_time_link',{from_placement_id:v.before.placement,to_placement_id:v.inside.placement},{minimum_minutes:20}),link('out','set_time_link',{from_placement_id:v.inside.placement,to_placement_id:v.after.placement},{minimum_minutes:20})]);
  f.write([f.change('decisions',d.route.decision,'accept_decision')]);
  const copy=f.write([f.change('options',d.routenormal.option,'copy_option',{data:{label:'Later slot'}})]),p=f.sources().placements.find(p=>p.scope_id===copy.change.scope);
  assert.equal(f.row('decisions',d.route.decision).resolution,'accepted');
  assert.equal(f.sources().deadline_rules.filter(r=>r.task_id===prep.prep.item).length,2);assert.equal(f.sources().time_links.filter(l=>l.from_placement_id===p.id||l.to_placement_id===p.id).length,2);
  f.write([f.change('placements',p.id,'upsert_placement',{data:{starts_at:time('07','05:30'),ends_at:time('07','06:30')}})]);
  f.write([f.change('decisions',d.route.decision,'reopen_decision',{key:'reopen',reason:'Try later slot'}),f.choose(d.route.decision,copy.change.option)]);
  assert.equal(f.row('deadlines',prep.target.link).at,time('06','05:30'));assert.equal(f.row('items',v.inside.item).note,'Shared note inside');
});

test('copying a partial alternative reports an unmapped timed neighbour instead of silently dropping the dependency',async t=>{
  const f=await fixture(t),d=f.write(decision()),v=f.write([...visit('a','07','05:00','06:00',d.routenormal.scope),...visit('b','07','07:00','08:00',d.routenormal.scope)]);
  f.write([link('order','set_time_link',{from_placement_id:v.a.placement,to_placement_id:v.b.placement},{minimum_minutes:30})]);
  const clone=key=>({key,type:'add_variant_placement',item_id:v[key].item,option_id:d.routeearly.option,expected_version:f.row('items',v[key].item).version,source_placement_id:v[key].placement});
  assert.throws(()=>f.preview([clone('a')]),e=>code('BRANCH_TIME_MAPPING_REQUIRED')(e)&&e.details.refs.some(r=>r.id===v.b.item));
  const both=f.write([clone('a'),clone('b')]);assert(f.sources().time_links.some(l=>l.from_placement_id===both.a.placement&&l.to_placement_id===both.b.placement));
});

test('acceptance does not approve slots or prevent later slot approval and recording a supplier result',async t=>{
  const f=await fixture(t),ids=scenario(f,{booked:false});f.write([f.change('decisions',ids.route.decision,'accept_decision')]);
  assert.equal(f.row('placements',ids.train.placement).commitment,'tentative');
  f.write([f.change('placements',ids.train.placement,'approve_placement')]);
  f.write([{key:'booking',type:'record_booking',data:{}},{key:'service',type:'add_service',booking_id:ref('booking','booking'),data:{kind:'transport',title:'Supplier changed train',state:'confirmed',validity:'exact_interval',starts_at:time('07','02:00'),ends_at:time('07','03:00'),start_timezone:TZ,end_timezone:TZ}},link('allocate','set_need_service',{need_id:ids.trainNeed.need,service_id:ref('service','service')})]);
  assert.equal(f.row('decisions',ids.route.decision).resolution,'accepted');assert.equal(f.row('placements',ids.train.placement).starts_at,time('07','01:00'));assert.equal(f.model().derived.schedule.placements.find(p=>p.id===ids.train.placement).requires_review,true);
  assert.throws(()=>f.preview([f.change('items',ids.train.item,'archive_item')]),code('REOPEN_REQUIRED'));
});

test('identical alternative use does not claim a released booking, and acknowledgement keys survive elapsed time and deadline edits',async t=>{
  const f=await fixture(t),ids=scenario(f),copy=f.write([f.change('options',ids.routenormal.option,'copy_option',{data:{label:'Same route'}})]);
  const same=f.preview([f.choose(ids.route.decision,copy.change.option)]);assert.equal(same.preview.allowed_acknowledgements.length,0);f.apply(same);
  const deadline=f.write([link('cancelBy','set_deadline',{}, {service_id:ids.hotelService.service,kind:'cancel_by',at:time('02','00:00'),timezone:TZ,origin:'provider'})]);
  const p=f.preview([f.choose(ids.route.decision,ids.routeearly.option),f.change('deadlines',deadline.cancelBy.link,'set_deadline',{key:'amend',data:{at:time('03','00:00')}})]);
  assert(p.preview.allowed_acknowledgements.length>0);f.apply(p,{now:NOW+2000});
  assert.equal(f.row('decisions',ids.route.decision).working_option_id,ids.routeearly.option);
});

test('held booking losing its matched location is surfaced even though it never counted as confirmed coverage',async t=>{
  const f=await fixture(t),ids=scenario(f);f.write([f.change('services',ids.hotelService.service,'correct_service',{data:{state:'held',hold_expires_at:NOW+60000},reason:'Only held, not paid'})]);
  const copy=f.write([f.change('options',ids.routenormal.option,'copy_option',{data:{label:'Different location'}})]),p=f.sources().placements.find(p=>p.scope_id===copy.change.scope&&p.item_id===ids.hotel.item),location=f.sources().placement_places.find(l=>l.placement_id===p.id),other=f.sources().places.find(p=>p.id!=='taipei-101');
  f.write([f.change('placement_places',location.id,'link_place',{placement_id:p.id,data:{place_id:other.id}})]);
  const preview=f.preview([f.choose(ids.route.decision,copy.change.option)]);assert(preview.preview.route_impact.bookings.some(b=>b.service_id===ids.hotelService.service&&b.lost_reserved_nights.length===3));
  assert.throws(()=>f.apply(preview,{now:NOW+60001}),code('PREVIEW_STALE'));
});

test('comparison evaluates deadline conflicts from the viewed branch without persisting its relative target cache',async t=>{
  const f=await fixture(t),ids=scenario(f),x=f.write([{key:'task',type:'create_item',data:{kind:'task',title:'Arrange change'}},link('action','set_service_task',{task_id:ref('task','item'),service_id:ids.trainService.service},{action:'review'}),
    link('target','set_deadline',{}, {task_id:ref('task','item'),mode:'relative',timezone:TZ}),...[ids.train.placement,ids.trainEarly.placement].map((p,i)=>link('r'+i,'set_deadline_rule',{task_id:ref('task','item'),anchor_placement_id:p},{offset_days:-1,rule_timezone:TZ})),
    link('supplier','set_deadline',{}, {service_id:ids.trainService.service,kind:'cancel_by',at:time('05','04:00'),timezone:TZ,origin:'provider'})]);
  assert(f.model().derived.issues.some(i=>i.code==='TARGET_AFTER_SUPPLIER_DEADLINE'));
  const before=fingerprint(f.sources()),view=f.compare([{decision_id:ids.route.decision,option_id:ids.routeearly.option}]);
  assert.equal(view.derived.deadlines.find(d=>d.id===x.target.link).at,time('05','01:00'));assert(!view.derived.issues.some(i=>i.code==='TARGET_AFTER_SUPPLIER_DEADLINE'));
  assert.equal(fingerprint(f.sources()),before);assert.equal(f.row('deadlines',x.target.link).at,time('06','01:00'));
});

test('a blank alternative keeps common requirements and route commands resolve a reused preparation task',async t=>{
  const f=await fixture(t),ids=scenario(f,{booked:false}),option=f.write([{key:'empty',type:'add_option',decision_id:ids.route.decision,expected_version:f.row('decisions',ids.route.decision).version,data:{label:'Undecided time'}}]);
  const created=f.write([{key:'blank',type:'add_variant_placement',item_id:ids.train.item,option_id:option.empty.option,expected_version:f.row('items',ids.train.item).version},
    {key:'reuse',type:'ensure_preparation',need_id:ids.trainNeed.need,expected_version:f.row('needs',ids.trainNeed.need).version},
    {key:'scope',type:'set_task_scope',id:ref('reuse','item'),expected_version:f.row('items',ids.trainPrep.item).version,scope_id:f.sources().scopes.find(s=>!s.parent_scope_id).id}]);
  assert.equal(created.reuse.item,ids.trainPrep.item);assert(f.sources().need_targets.some(l=>l.placement_id===created.blank.placement&&l.need_id===ids.trainNeed.need));
  f.write([f.choose(ids.route.decision,option.empty.option)]);assert.equal(f.model().derived.needs.find(n=>n.id===ids.trainNeed.need).applicability,'active');
  assert.notEqual(f.model().derived.placements.find(p=>p.id===created.blank.placement).readiness,'not_required');
});

test('including a previously excluded placement is a material change to an accepted section',async t=>{
  const f=await fixture(t),d=f.write(decision()),v=f.write(visit('optional','07','05:00','06:00',d.routenormal.scope));
  f.write([f.choose(d.route.decision,d.routenormal.option),f.change('placements',v.optional.placement,'set_participation',{key:'exclude',participation:'excluded'}),f.change('decisions',d.route.decision,'accept_decision',{key:'accept'})]);
  assert.throws(()=>f.preview([f.change('placements',v.optional.placement,'set_participation',{participation:'included'})]),code('REOPEN_REQUIRED'));
});
