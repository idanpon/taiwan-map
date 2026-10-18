import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,statSync,readFileSync,copyFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {openDatabase,migrate} from '../server/database.mjs';
import {handle,passwordHash,sha} from '../src/core.mjs';
import {importExport} from '../server/import.mjs';
import {updatePlaceTags} from '../server/update-place-tags.mjs';
import {emptyTags,mergeTags,readTags,hasTag,matchesTags,eventEnded,taipeiDay,tagsHeading,tagsDetails,bookingUrl} from '../public/place-tags.js';
import {helpContent} from '../public/help.js';
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const example={photoSpot:true,limitedDates:{enabled:true,startDate:'2026-12-29',endDate:'2027-01-05',scheduleText:'29–31 декабря: 10:00–20:00\n1 января: закрыто'},reservation:{enabled:true,url:'https://example.com/booking?x=1&y=2'}};
async function fixture(DB=openDatabase()){
 migrate(DB,'drizzle');
 const env={DB,APP_ORIGIN:'https://test.example',AUTH_MODE:'bearer',APP_PASSWORD_HASH:await passwordHash('fixture-password')};
 const tokens={};
 const call=(path,method='GET',data,role='owner')=>handle(new Request(env.APP_ORIGIN+path,{method,headers:{Origin:env.APP_ORIGIN,...(tokens[role]?{Authorization:'Bearer '+tokens[role]}:{}),...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
 tokens.owner=(await(await call('/api/login','POST',{password:'fixture-password'})).json()).token;
 for(const [i,role] of ['admin','editor','viewer'].entries()){
  tokens[role]=String(i+1).repeat(64);DB.sqlite.prepare('INSERT INTO users(id,display_name,created_at) VALUES(?,?,?)').run(role,role,1);DB.sqlite.prepare('INSERT INTO memberships VALUES(?,?,?)').run('taiwan-2026',role,role);DB.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await sha(tokens[role]),role,Date.now()+1e6);
 }
 return {DB,call};
}
test('tags are optional, independently enabled and deeply patched without losing disabled data',()=>{
 assert.deepEqual(readTags(),emptyTags());let tags=mergeTags(undefined,example);
 const next=mergeTags(tags,{limitedDates:{enabled:false},reservation:{enabled:false}});
 assert.equal(next.photoSpot,true);assert.equal(next.limitedDates.scheduleText,example.limitedDates.scheduleText);assert.equal(tags.limitedDates.enabled,true);
 assert.equal(tagsDetails(next,esc),'');assert.equal(hasTag(next,'limitedDates'),false);
 assert.equal(mergeTags(next,{limitedDates:{enabled:true}}).limitedDates.startDate,'2026-12-29');
 for(const patch of [null,[],{invented:true},{photoSpot:1},{limitedDates:null},{limitedDates:{enabled:'true'}},{limitedDates:{startDate:'2026-02-29'}},{limitedDates:{startDate:'2027-01-06',endDate:'2027-01-05'}},{limitedDates:{scheduleText:'a'.repeat(2001)}},{reservation:{url:'javascript:alert(1)'}},{reservation:{url:'https://user:pass@example.com'}},{reservation:{url:'https://example.com/'+ 'a'.repeat(1024)}}])assert.throws(()=>mergeTags(undefined,patch));
 assert.ok(bookingUrl('http://example.com/book'));assert.ok(mergeTags(undefined,{limitedDates:{startDate:'2028-02-29'}}));
});
test('OR tag selection never matches untagged places and works with other groups using AND',()=>{
 const places=[{city:'Taipei',category:'food',tags:{photoSpot:true}},{city:'Taipei',category:'food',tags:{reservation:{enabled:true}}},{city:'Tainan',category:'food',tags:example},{city:'Taipei',category:'museum',tags:example},{city:'Taipei',category:'food'}];
 assert.equal(places.filter(p=>matchesTags(p.tags,new Set())).length,5);
 assert.equal(places.filter(p=>matchesTags(p.tags,new Set(['photoSpot','reservation']))).length,4);
 const filtered=places.filter(p=>p.city==='Taipei'&&p.category==='food'&&matchesTags(p.tags,new Set(['photoSpot','reservation'])));assert.equal(filtered.length,2);
 assert.equal(places.filter(p=>matchesTags(p.tags,new Set(['limitedDates']))).length,2);
});
test('end dates are inclusive Taiwan calendar days, independent of device zone, free text and status',()=>{
 const tags=mergeTags(undefined,example);assert.equal(taipeiDay(new Date('2027-01-05T16:00:00Z')),'2027-01-06');
 assert.equal(eventEnded(tags,new Date('2027-01-05T15:59:59Z')),false);assert.equal(eventEnded(tags,new Date('2027-01-05T16:00:00Z')),true);
 assert.equal(eventEnded({limitedDates:{enabled:true,scheduleText:'Ended in 2020'}}),false);assert.equal(eventEnded(mergeTags(tags,{limitedDates:{enabled:false}}),new Date('2030-01-01')),false);
 assert.equal(matchesTags(tags,new Set(['limitedDates'])),true);
});
test('card tags have no reserved block when absent, safe links and escaped multiline initially collapsed schedules',()=>{
 assert.equal(tagsHeading(undefined,esc),'');assert.equal(tagsDetails(undefined,esc),'');
 const heading=tagsHeading(example,esc);assert.equal((heading.match(/data-tag-info=/g)||[]).length,3);assert.match(heading,/title="Хорошее место для фотографий"/);
 const tags=mergeTags(undefined,example);tags.limitedDates.scheduleText='<script>unsafe</script>\n  Keep spaces';
 const html=tagsDetails(tags,esc,new Date('2027-01-06'));assert.match(html,/&lt;script&gt;unsafe/);assert.ok(html.includes('\n  Keep spaces'));assert.ok(!html.includes('<script>'));assert.match(html,/<details class="place-schedule">/);assert.ok(!html.includes('<details open'));assert.match(html,/Событие завершилось/);assert.match(html,/rel="noopener noreferrer"/);assert.match(html,/target="_blank"/);assert.match(html,/x=1&amp;y=2/);
 assert.ok(!tagsDetails({limitedDates:{enabled:true,endDate:'2027-01-05'}},esc).includes('Показать расписание'));
 assert.match(tagsDetails({reservation:{enabled:true}},esc),/предварительная бронь/);
});
test('API restricts writes, preserves nested fields, detects conflicts, persists independently of notes and exports/hidden places',async()=>{
 const f=await fixture();try{
  const path='/api/places/taipei-101/tags';
  assert.equal((await f.call(path,'PUT',{version:1,tags:example},'viewer')).status,403);
  assert.equal((await f.call(path,'PUT',{version:1,tags:example},'unknown')).status,401);
  assert.equal((await f.call(path,'PUT',{version:1,tags:example},'editor')).status,200);
  assert.equal((await f.call(path,'PUT',{version:1,tags:{photoSpot:false}},'admin')).status,409);
  assert.equal((await f.call(path,'PUT',{version:2,tags:{reservation:{enabled:false}}},'admin')).status,200);
  assert.equal((await f.call(path,'PUT',{version:3,tags:{reservation:{url:'data:text/html,bad'}}})).status,400);
  assert.equal((await f.call('/api/places/missing/tags','PUT',{version:1,tags:{}})).status,404);
  assert.equal((await f.call('/api/places/taipei-101/state','PUT',{version:0,status_id:'visited',note:'Keep me'})).status,200);
  let p=(await(await f.call('/api/data')).json()).places.find(p=>p.id==='taipei-101');assert.equal(p.tags.reservation.url,example.reservation.url);assert.equal(p.tags.reservation.enabled,false);assert.equal(p.tags_version,3);assert.equal(p.version,1);assert.equal(p.note,'Keep me');assert.ok(!('tags_json' in p));
  await f.call('/api/places/taipei-101/visibility','PUT',{version:1,hidden:true});
  p=(await(await f.call('/api/places/hidden','GET',undefined,'editor')).json()).places[0];assert.equal(p.tags.photoSpot,true);
  const exported=await(await f.call('/api/export')).json();p=exported.places.find(p=>p.id==='taipei-101');assert.equal(p.tags.limitedDates.scheduleText,example.limitedDates.scheduleText);
  const restored=openDatabase();try{migrate(restored,'drizzle');importExport(restored,exported);assert.deepEqual(readTags(restored.sqlite.prepare('SELECT tags_json FROM places WHERE id=?').get(p.id).tags_json),p.tags);assert.equal(restored.sqlite.prepare('SELECT tags_version FROM places WHERE id=?').get(p.id).tags_version,3)}finally{restored.close()}
  await f.call('/api/places/taipei-101/visibility','PUT',{version:2,hidden:false});
  assert.equal((await(await f.call('/api/data')).json()).places.find(p=>p.id==='taipei-101').note,'Keep me');
 }finally{f.DB.close()}
});
test('tag migration is additive, idempotent and retains every old column/table',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'taiwan-tags-migration-')),DB=openDatabase();try{
  for(const name of readdirSync('drizzle').filter(n=>/^\d+.*\.sql$/.test(n)&&n<'0006'))copyFileSync('drizzle/'+name,join(directory,name));
  migrate(DB,directory);const env={DB,APP_ORIGIN:'https://test.example',APP_PASSWORD_HASH:await passwordHash('fixture-password')};await handle(new Request(env.APP_ORIGIN+'/api/login',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({password:'fixture-password'})}),env);
  const tables=DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_app_migrations'").all().map(x=>x.name);
  const before=tables.map(name=>({name,columns:DB.sqlite.prepare('PRAGMA table_info('+name+')').all().map(c=>c.name),rows:DB.sqlite.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()}));
  migrate(DB,'drizzle');migrate(DB,'drizzle');
  for(const {name,columns,rows} of before)assert.deepEqual(DB.sqlite.prepare('SELECT '+columns.join(',')+' FROM '+name+' ORDER BY rowid').all(),rows);
  assert.ok(DB.sqlite.prepare('SELECT tags_json,tags_version FROM places').all().every(p=>p.tags_json==='{}'&&p.tags_version===1));assert.deepEqual(DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{DB.close();rmSync(directory,{recursive:true,force:true})}
});
test('private management batch backs up before apply, survives restart and rolls back invalid or stale batches',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'taiwan-tags-cli-')),database=join(directory,'db.sqlite');const f=await fixture(openDatabase(database));f.DB.close();
 try{
  const manifest=join(directory,'tags.json'),snapshot=join(directory,'backup.sqlite');writeFileSync(manifest,JSON.stringify({schema_version:1,places:[{id:'taipei-101',version:1,tags:example}]}));
  const run=(...args)=>spawnSync(process.execPath,['server/update-place-tags.mjs',manifest,...args],{env:{...process.env,DATABASE_PATH:database},encoding:'utf8'});
  assert.equal(run('--check').status,0);assert.equal(run('--apply',snapshot).status,0);assert.equal(statSync(snapshot).mode&0o777,0o600);
  const old=openDatabase(snapshot),db=openDatabase(database);try{
   assert.deepEqual(readTags(old.sqlite.prepare('SELECT tags_json FROM places WHERE id=?').get('taipei-101').tags_json),emptyTags());assert.equal(readTags(db.sqlite.prepare('SELECT tags_json FROM places WHERE id=?').get('taipei-101').tags_json).photoSpot,true);
   const before=db.sqlite.prepare('SELECT * FROM places ORDER BY id').all();
   assert.throws(()=>updatePlaceTags(db.sqlite,{schema_version:1,places:[{id:'taipei-101',version:2,tags:{photoSpot:false}},{id:'chimei',version:1,tags:{reservation:{url:'javascript:bad'}}}]},{apply:true}));assert.deepEqual(db.sqlite.prepare('SELECT * FROM places ORDER BY id').all(),before);
   assert.throws(()=>updatePlaceTags(db.sqlite,{schema_version:1,places:[{id:'taipei-101',version:1,tags:{}}]},{apply:true}));
  }finally{old.close();db.close()}
  assert.notEqual(run('--apply',snapshot).status,0);
 }finally{rmSync(directory,{recursive:true,force:true})}
});
test('help documents tags, inclusive Taiwan dates, booking, disclosure, OR/AND and private management without naming particular statuses',()=>{
 const text=helpContent({categories:[],user:{role:'viewer'}},esc);
 for(const term of ['Дополнительные ярлыки','Фотоспот','Ограничено по датам','Нужна бронь','Показать расписание','Событие завершилось','Asia/Taipei','ИЛИ','И между группами','управляющий аккаунт ChatGPT','Самостоятельное добавление мест через интерфейс сайта пока недоступно'])assert.ok(text.includes(term),term);
});
