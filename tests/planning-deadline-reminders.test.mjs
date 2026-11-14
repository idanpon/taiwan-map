import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readdirSync,copyFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate } from '../server/database.mjs';
import { run,all,one } from '../src/sqlite.mjs';
import { TRIP,sha } from '../src/auth.mjs';
import { createPushScheduler } from '../server/push-scheduler.mjs';
import { applyPlanningChange } from '../src/planning.mjs';
import { routeFixture,ref,NOW } from './route-ui-fixture.mjs';
import {deadlineTarget} from '../public/planning-deadline-view.js';

const future='2035-01-04T05:00:00.000Z';
test('a held service deadline stops being applicable at its explicit expiry without a plan edit',async t=>{
 const f=await routeFixture(t),ids=booking(f),expires=NOW+3600000;
 f.write([f.change('services',ids.service.service,'correct_service',{data:{state:'held',hold_expires_at:expires},reason:'Supplier hold'})]);
 const s=f.model().sources;
 assert.equal(deadlineTarget(s,ids.deadline.link,undefined,expires-1)._applicable,true);
 assert.equal(deadlineTarget(s,ids.deadline.link,undefined,expires)._applicable,false);
});
function booking(f){return f.write([
 {key:'booking',type:'record_booking',data:{category:'lodging',provider_name:'Example hotel'}},
 {key:'service',type:'add_service',booking_id:ref('booking','booking'),data:{kind:'stay',state:'confirmed',title:'Hotel reservation',validity:'date_range',date_start:'2035-01-06',date_end:'2035-01-07',start_timezone:'Asia/Taipei'}},
 {key:'deadline',type:'set_deadline',expected_version:0,data:{service_id:ref('service','service'),task_id:null,kind:'cancel_by',at:future,local_date:null,timezone:'Asia/Taipei',origin:'provider',source_url:null,note:'Do not send note',mode:null}}
]);}
async function rule(f,id,who='viewer',extra={}){
 const path='/api/planning/deadlines/'+id+'/reminder',prior=(await f.call(path,'GET',undefined,who)).data.reminder;
 return f.call(path,'PUT',{version:prior?.version??null,item_version:f.row('deadlines',id).version,timezone_revision:1,enabled:true,offset_minutes:60,...extra},who);
}
async function device(f){run(f.db,`INSERT INTO push_devices(id,user_id,session_hash,installation_id,name,endpoint,p256dh,auth,enabled_from,last_seen)
 VALUES('device','viewer',?,'installation','Test','https://fcm.googleapis.com/test','test','test',1,1)`,await sha(f.tokens.viewer));}

test('0019 preserves reminder IDs, sent generations and child deliveries with foreign keys enabled',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'before-deadlines-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')&&f<'0019'))copyFileSync(join('drizzle',file),join(dir,file));
 const f=await routeFixture(t,{migrations:dir,upgrade:false});
 const {item}=await applyPlanningChange(f.db,f.users.editor,{path:'/api/planning/items',method:'POST',body:{kind:'task',title:'Preserve',date_end:'2035-01-04'}}).json();
 await device(f);
 run(f.db,"INSERT INTO planning_reminders(id,user_id,item_id,enabled,mode,local_time,fires_at,version,generation,sent_generation,updated_at) VALUES('reminder','viewer',?,1,'day','09:00',123,7,4,3,1)",item.id);
 run(f.db,"INSERT INTO push_deliveries VALUES('delivery','reminder',3,'device','sent',1,100,200)");
 const before=one(f.db,"SELECT * FROM planning_reminders WHERE id='reminder'"),delivery=one(f.db,"SELECT * FROM push_deliveries WHERE id='delivery'");
 migrate(f.db,'drizzle');
 assert.deepEqual({...one(f.db,"SELECT * FROM planning_reminders WHERE id='reminder'")},{...before,deadline_id:null});
 assert.deepEqual(one(f.db,"SELECT * FROM push_deliveries WHERE id='delivery'"),delivery);
 assert.deepEqual(all(f.db,'PRAGMA foreign_key_check'),[]);
 assert.equal(one(f.db,'PRAGMA integrity_check').integrity_check,'ok');
});

test('viewer can subscribe privately to unused reservation cancellation deadline; preview aggregates other participants',async t=>{
 const f=await routeFixture(t),ids=booking(f),id=ids.deadline.link;
 assert.equal((await rule(f,id)).status,200);
 assert.equal((await f.call('/api/planning/deadlines/'+id+'/reminder')).data.reminder,null);
 const p=f.preview([f.change('deadlines',id,'set_deadline',{data:{at:'2035-01-04T06:00:00.000Z'}})]);
 assert.equal(p.preview.reminder_impact.others_count,1);assert.deepEqual(p.preview.reminder_impact.mine,[]);
 f.apply(p);
 assert.equal(one(f.db,'SELECT fires_at FROM planning_reminders WHERE deadline_id=?',id).fires_at,Date.parse(future));
 const stale=f.preview([f.change('bookings',ids.booking.booking,'edit_booking',{data:{note:'Keep'}})]);
 assert.equal((await rule(f,id,'viewer',{offset_minutes:30})).status,200);
 assert.throws(()=>f.apply(stale),e=>e.details?.code==='PREVIEW_STALE');
 run(f.db,"DELETE FROM memberships WHERE user_id='viewer'");
 assert.equal((await f.call('/api/planning/deadlines/'+id+'/reminder','GET',undefined,'viewer')).status,401);
});

test('supplier deadline date uses its own zone and cancellation retires queued delivery without rearming sent generations',async t=>{
 const f=await routeFixture(t),ids=booking(f),id=ids.deadline.link;
 f.write([f.change('deadlines',id,'set_deadline',{data:{at:null,local_date:'2035-01-04'}})]);
 const r=await rule(f,id,'viewer',{local_time:'09:00'});assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.reminder.scheduled.at,Date.parse('2035-01-04T01:00:00Z'));
 await device(f);const reminder=one(f.db,'SELECT * FROM planning_reminders WHERE deadline_id=?',id);
 run(f.db,"INSERT INTO push_deliveries VALUES('queued',?,?,'device','queued',0,1,9999999999999)",reminder.id,reminder.generation);
 f.write([f.change('services',ids.service.service,'set_service_state',{state:'cancelled',reason:'Cancelled by supplier'})]);
 assert.equal(one(f.db,"SELECT state FROM push_deliveries WHERE id='queued'").state,'expired');
 const after=(await f.call('/api/planning/deadlines/'+id+'/reminder','GET',undefined,'viewer')).data.reminder;
 assert.equal(after.active,false);assert.equal(after.enabled,true);
 assert.equal((await rule(f,id,'viewer',{local_time:'09:00'})).status,400);
});

test('scheduler delivers a service deadline deep link without notes; shared edits do not resend delivered reminders',async t=>{
 const f=await routeFixture(t),ids=booking(f),id=ids.deadline.link;
 await device(f);assert.equal((await rule(f,id)).status,200);
 let now=Date.parse(future)-3600000;const sent=[];
 const scheduler=createPushScheduler(f.db,async(_device,payload)=>{sent.push(payload);return 'sent';},{now:()=>now});
 await scheduler.tick();await scheduler.tick();assert.equal(sent.length,1);
 assert.equal(sent[0].path,'planning.html#deadline='+id);assert(!JSON.stringify(sent).includes('Do not send note'));
 const before=one(f.db,'SELECT * FROM planning_reminders WHERE deadline_id=?',id);
 f.write([f.change('deadlines',id,'set_deadline',{data:{at:'2035-01-04T06:00:00.000Z'}})]);
 const after=one(f.db,'SELECT * FROM planning_reminders WHERE deadline_id=?',id);
 assert.equal(after.generation,before.generation);assert.equal(after.sent_generation,before.sent_generation);
 now+=3600000;await scheduler.tick();assert.equal(sent.length,1);
});
