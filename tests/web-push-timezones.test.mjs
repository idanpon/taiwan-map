import test from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,randomBytes} from 'node:crypto';
import {openDatabase,migrate} from '../server/database.mjs';
import {createPushScheduler} from '../server/push-scheduler.mjs';
import {handle,passwordHash,sha} from '../src/core.mjs';
import {TRIP,SHARED_USER} from '../src/auth.mjs';
import {localInstants,tripLocalInstants,localConflict,resolveLocalChoice,localPoint,minute} from '../public/trip-timezones.js';
import {itemDates} from '../public/planning-model.js';

async function fixture(){
 const DB=openDatabase();migrate(DB,'drizzle');const events=[];
 const env={DB,APP_ORIGIN:'https://api.example',AUTH_MODE:'bearer',APP_PASSWORD_HASH:await passwordHash('fixture-push'),PUSH:{publicKey:'test-key',send:async(...args)=>{events.push(args);return 'sent'}}};
 const tokens={};
 async function call(path,method='GET',value,who='editor'){
  const headers={Origin:env.APP_ORIGIN,'Content-Type':'application/json',...(tokens[who]?{Authorization:'Bearer '+tokens[who]}:{})};
  const res=await handle(new Request(env.APP_ORIGIN+path,{method,headers,...(value===undefined?{}:{body:JSON.stringify(value)})}),env);
  return {status:res.status,data:await res.json()};
 }
 async function ok(path,method,value,who,expected=200){
  const {status,data}=await call(path,method,value,who);assert.equal(status,expected,JSON.stringify(data));return data;
 }
 tokens.admin=(await ok('/api/login','POST',{password:'fixture-push'},null)).token;
 DB.sqlite.exec("INSERT INTO app_meta VALUES('accounts_v1','shared')");
 for(const role of ['editor','viewer']){
  tokens[role]=randomBytes(32).toString('hex');
  DB.sqlite.prepare('INSERT INTO users(id,display_name,created_at) VALUES(?,?,?)').run(role,role,1);
  DB.sqlite.prepare('INSERT INTO memberships VALUES(?,?,?)').run(TRIP,role,role);
  DB.sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await sha(tokens[role]),role,Date.now()+86400000);
 }
 const create=async(value)=> (await ok('/api/planning/items','POST',{kind:'task',title:'План',...value},'editor',201)).item;
 const reminder=(id)=>'/api/planning/items/'+id+'/reminder';
 async function rule(item,props={},who='viewer'){
  const path=reminder(item.id),previous=(await ok(path,'GET',undefined,who)).reminder;
  const {timezone_plan:plan}=await ok('/api/planning','GET',undefined,who);
  return call(path,'PUT',{version:previous?.version??null,item_version:item.version,timezone_revision:plan.revision,enabled:true,...props},who);
 }
 async function zones(changes){
  const {trip,timezone_plan}=await ok('/api/planning');
  return {version:trip.version,timezone_revision:timezone_plan.revision,departure_date:trip.departure_date,start_date:trip.start_date,end_date:trip.end_date,changes};
 }
 const devices=async(who='viewer',i=1,endpoint)=>ok('/api/notifications/devices','POST',subscription(i,endpoint),who);
 return {DB,call,ok,create,rule,reminder,zones,devices,events};
}
function subscription(i,endpoint){
 const ecdh=createECDH('prime256v1');
 return {name:'Устройство '+i,installation_id:'00000000-0000-4000-a000-'+String(i).padStart(12,'0'),subscription:{
  endpoint:endpoint||'https://fcm.googleapis.com/fcm/send/example-'+i,keys:{p256dh:ecdh.generateKeys().toString('base64url'),auth:randomBytes(16).toString('base64url')}
 }};
}
const arrival=(day,time,zone,region)=>({day,time,zone,region});
const gap=[arrival('2035-12-29','13:00','Asia/Taipei','Тайвань')];

test('route time covers missing and repeated clocks, half-hour DST and local calendar dates',()=>{
 const east={changes:[{at:Date.parse('2035-12-29T05:00Z'),zone:'Asia/Taipei',region:'Тайвань'}]};
 assert.equal(localPoint('2035-12-29T04:59Z',east).time,'07:59');
 assert.equal(localPoint('2035-12-29T05:00Z',east).time,'13:00');
 assert.equal(localConflict('2035-12-29','09:00',east).kind,'gap');
 assert.equal(localConflict('2035-12-29','09:00',east).before.time,'07:59');
 assert.equal(resolveLocalChoice(localConflict('2035-12-29','09:00',east),{kind:'custom',time:'09:00',zone:'Europe/Moscow'},east),null);
 const west={changes:[{at:Date.parse('2035-12-29T05:00Z'),zone:'America/New_York',region:'Нью-Йорк'}]};
 const repeated=localConflict('2035-12-29','03:00',west);
 assert.equal(repeated.kind,'repeat');assert.equal(repeated.after.at-repeated.before.at,8*60*minute);
 assert.equal(resolveLocalChoice(repeated,{kind:'after'},west).zone,'America/New_York');
 assert.deepEqual(localInstants('2026-10-04','02:15','Australia/Lord_Howe'),[]);
 const half=localInstants('2026-04-05','01:45','Australia/Lord_Howe');assert.equal(half[1]-half[0],30*minute);
 assert.equal(tripLocalInstants('2035-12-29','08:00',east).length,0);
 assert.deepEqual(itemDates({kind:'visit',starts_at:'2035-12-29T20:00Z'},east),['2035-12-30','2035-12-30']);
 assert.deepEqual(itemDates({date_end:'2035-12-29'},east),['2035-12-29','2035-12-29']);
});

test('private reminders survive a zone gap; preview is atomic and exposes only aggregates for others',async()=>{
 const f=await fixture();try{
  const i=await f.create({title:'Задача на день',date_end:'2035-12-29',note:'Приватная заметка'}),timed=await f.create({kind:'visit',starts_at:'2035-12-29T20:00:00Z',ends_at:'2035-12-30T01:00:00Z'});
  const anonymous=await f.call(f.reminder(i.id),'GET',undefined,'guest');assert.equal(anonymous.status,401);
  const rule=(await f.rule(i,{local_time:'09:00'})).data.reminder;
  assert.equal(rule.scheduled.at,Date.parse('2035-12-29T06:00Z'));
  assert.equal((await f.ok(f.reminder(i.id))).reminder,null);
  assert.equal((await f.rule(i,{local_time:'08:30'},'editor')).status,200);
  const draft=await f.zones(gap);
  assert.equal((await f.call('/api/planning/timezones/preview','POST',draft,'viewer')).status,403);
  const preview=await f.ok('/api/planning/timezones/preview','POST',draft);
  assert.deepEqual(preview.others,{shifted:0,frozen:1});assert.equal(preview.mine.length,1);
  assert.equal(preview.mine[0].check.kind,'gap');assert.ok(!JSON.stringify(preview).includes('Приватная заметка'));
  const rejected=await f.call('/api/planning/timezones','PUT',{...draft,fingerprint:preview.fingerprint,choices:{}});
  assert.equal(rejected.status,400);
  assert.equal((await f.ok('/api/planning')).timezone_plan.revision,1);
  assert.equal((await f.rule(i,{local_time:'09:01'})).status,200);
  const stale=await f.call('/api/planning/timezones','PUT',{...draft,fingerprint:preview.fingerprint,choices:{[preview.mine[0].id]:{kind:'before'}}});
  assert.equal(stale.status,409);
  await f.ok('/api/planning/timezones','PUT',{...draft,fingerprint:stale.data.details.preview.fingerprint,choices:{[preview.mine[0].id]:{kind:'before'}}});
  const frozen=(await f.ok(f.reminder(i.id),'GET',undefined,'viewer')).reminder;
  assert.equal(frozen.scheduled.at,rule.scheduled.at+minute);assert.equal(frozen.scheduled.time,'14:01');assert.equal(frozen.review,'gap');assert.equal(frozen.enabled,true);
  const own=(await f.ok(f.reminder(i.id))).reminder;assert.equal(own.scheduled.time,'07:59');assert.equal(own.review,null);
  const shared=await f.ok('/api/planning','GET',undefined,'viewer');
  assert.equal(shared.items.find(x=>x.id===timed.id).starts_at,timed.starts_at);
  assert.equal(shared.items.find(x=>x.id===timed.id).ends_at,timed.ends_at);
  const exported=await f.ok('/api/export','GET',undefined,'viewer');
  assert.equal('reminders' in exported.planning,false);assert.equal('devices' in exported,false);
  const second=await f.zones([]),next=await f.ok('/api/planning/timezones/preview','POST',second);
  await f.ok('/api/planning/timezones','PUT',{...second,fingerprint:next.fingerprint,choices:{}});
  assert.equal((await f.ok(f.reminder(i.id),'GET',undefined,'viewer')).reminder.scheduled.at,frozen.scheduled.at);
 }finally{f.DB.close()}
});

test('a personal time check offers explicit alternatives; period reminders use their first day',async()=>{
 const f=await fixture();try{
  const draft=await f.zones(gap),preview=await f.ok('/api/planning/timezones/preview','POST',draft);
  await f.ok('/api/planning/timezones','PUT',{...draft,fingerprint:preview.fingerprint,choices:{}});
  const i=await f.create({date_start:'2035-12-29',date_end:'2035-12-31'});
  const result=await f.rule(i,{local_time:'09:00'});assert.equal(result.status,409);
  const {fingerprint,check}=result.data.details;assert.equal(check.day,'2035-12-29');
  assert.equal((await f.ok(f.reminder(i.id),'GET',undefined,'viewer')).reminder,null);
  const impossible=await f.rule(i,{local_time:'09:00',fingerprint,choice:{kind:'custom',time:'10:00',zone:'Asia/Taipei'}});
  assert.equal(impossible.status,400);
  const resolved=await f.rule(i,{local_time:'09:00',fingerprint,choice:{kind:'after'}});
  assert.equal(resolved.status,200);assert.equal(resolved.data.reminder.scheduled.time,'13:00');
  const moved=(await f.ok('/api/planning/items/'+i.id,'PUT',{version:i.version,date_start:'2035-12-30'})).item;
  assert.equal((await f.ok(f.reminder(i.id),'GET',undefined,'viewer')).reminder.scheduled.time,'09:00');
  await f.ok('/api/planning/items/'+i.id,'PUT',{version:moved.version,date_start:null,date_end:null});
  const invalid=(await f.ok(f.reminder(i.id),'GET',undefined,'viewer')).reminder;
  assert.equal(invalid.scheduled,null);assert.equal(invalid.review,'date_changed');
 }finally{f.DB.close()}
});

test('device ownership, pause and logout are enforced before private delivery',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call('/api/notifications/devices','POST',subscription(1,'https://fcm.googleapis.com.evil.test/fcm/send/fake'),'viewer')).status,400);
  assert.equal((await f.call('/api/notifications/devices','POST',subscription(1),'guest')).status,401);
  const d=(await f.devices()).devices[0];
  assert.equal(d.endpoint,undefined);assert.equal(d.auth,undefined);
  assert.equal((await f.ok('/api/notifications')).devices.length,0);
  assert.equal((await f.call('/api/notifications/devices/'+d.id+'/test','POST',{})).status,404);
  await f.ok('/api/notifications/devices/'+d.id+'/test','POST',{},'viewer');assert.equal(f.events.length,1);
  assert.equal((await f.call('/api/notifications/devices/'+d.id+'/test','POST',{},'viewer')).status,429);
  await f.ok('/api/notifications/preferences','PUT',{paused:true},'viewer');
  assert.equal((await f.call('/api/notifications/devices/'+d.id+'/test','POST',{},'viewer')).status,409);
  const i=await f.create({date_start:'2035-12-29'});assert.equal((await f.rule(i,{local_time:'09:00'})).status,200);
  await f.ok('/api/logout','POST',{},'viewer');
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM push_devices').get().n,0);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM planning_reminders').get().n,1);
 }finally{f.DB.close()}
});

test('queue retries known rejections across restart, skips stale sends and expires invalid devices',async()=>{
 const f=await fixture();try{
  await f.devices('viewer',1);await f.devices('viewer',2,'https://web.push.apple.com/QzExample');
  const baseline=Date.now(),at=baseline+10*minute;
  const i=await f.create({kind:'visit',starts_at:new Date(at).toISOString(),title:'Экскурсия',note:'Не передавать'});
  const closed=await f.create({starts_at:new Date(at).toISOString(),title:'Отменённое'});
  for(const item of [i,closed])assert.equal((await f.rule(item,{offset_minutes:5})).status,200);
  await f.ok('/api/planning/items/'+closed.id,'PUT',{version:closed.version,state:'cancelled'});
  let clock=at-5*minute;const attempts=[];
  let scheduler=createPushScheduler(f.DB,async(device,payload,ttl)=>{
   attempts.push({device,payload,ttl});return device.endpoint.includes('apple.com')?'expired':'retry';
  },{now:()=>clock});
  await scheduler.tick();assert.equal(attempts.length,2);
  assert.ok(attempts.every(a=>a.payload.title==='Экскурсия'&&a.payload.path.endsWith(i.id)&&!JSON.stringify(a.payload).includes('Не передавать')));
  assert.ok(attempts.every(a=>a.ttl<=300));
  clock+=minute;
  scheduler=createPushScheduler(f.DB,async(device,payload)=>{attempts.push({device,payload});return 'sent'},{now:()=>clock});
  await scheduler.tick();await scheduler.tick();assert.equal(attempts.length,3);
  assert.equal((await f.ok(f.reminder(i.id),'GET',undefined,'viewer')).reminder.sent,true);
  assert.equal((await f.ok('/api/notifications','GET',undefined,'viewer')).devices.filter(d=>d.expired).length,1);
  const changed=await f.ok('/api/planning/items/'+i.id,'PUT',{version:i.version,starts_at:new Date(at+60*minute).toISOString()});
  clock=at+55*minute;await scheduler.tick();assert.equal(attempts.length,3);
  assert.equal((await f.rule(changed.item,{offset_minutes:0})).status,200);
  await f.ok('/api/notifications/preferences','PUT',{paused:true},'viewer');clock=at+60*minute;await scheduler.tick();assert.equal(attempts.length,3);
 }finally{f.DB.close()}
});
