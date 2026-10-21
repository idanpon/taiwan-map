import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve} from 'node:path';
import {openDatabase,migrate} from '../server/database.mjs';import {handle,passwordHash} from '../src/core.mjs';
const temp=mkdtempSync(resolve(tmpdir(),'taiwan-test-'));let DB=openDatabase(resolve(temp,'test.sqlite'));migrate(DB,resolve('drizzle'));
const env={DB,APP_PASSWORD_HASH:await passwordHash('test-password-only'),APP_ORIGIN:'https://test.example'};let cookie='';
const call=async(path,method='GET',body,extra={},ip='test-ip')=>handle(new Request('https://test.example'+path,{method,headers:{Origin:'https://test.example',Cookie:cookie,...(body!==undefined?{'Content-Type':'application/json'}:{}),...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env,{clientIp:ip});
test('authentication, seeded catalog, server persistence, custom status, isolation and conflicts',async t=>{
 assert.equal((await call('/api/data')).status,401);
 assert.equal((await call('/api/login','POST',{password:'wrong'})).status,401);
 assert.equal((await call('/api/login','POST',{password:'test-password-only'},{Origin:'https://evil.example'})).status,403);
 let r=await call('/api/login','POST',{password:'test-password-only'});assert.equal(r.status,200);const set=r.headers.get('set-cookie');assert.match(set,/HttpOnly/);assert.match(set,/Secure/);cookie=set.split(';')[0];
 assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM sessions').get().n,1);assert.notEqual(DB.sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash,cookie.split('=')[1]);
 let data=await(await call('/api/data')).json();assert.equal(data.places.length,10);assert.equal(data.categories.length,10);assert.equal(new Set(data.places.map(p=>p.city)).size,2);for(const p of data.places){assert.ok(p.links.length);assert.equal(p.hours.timezone,'Asia/Taipei');assert.ok(p.lat>22&&p.lat<26);assert.ok(p.lon>120&&p.lon<122)}
 r=await call('/api/statuses','POST',{label:'Обязательно',color:'#123456'});assert.equal(r.status,201);const custom=await r.json();
 assert.equal((await call('/api/statuses','POST',{label:'Обязательно',color:'#123456'})).status,409);
 assert.equal((await call('/api/statuses','POST',{label:'bad',color:'red;script'})).status,400);
 const state={status_id:custom.id,note:'Заметка <script>не HTML</script>',version:0};r=await call('/api/places/taipei-101/state','PUT',state);assert.equal(r.status,200);assert.equal((await r.json()).version,1);
 assert.equal((await call('/api/places/taipei-101/state','PUT',state)).status,409);
 r=await call('/api/places/taipei-101/state','PUT',{...state,version:1,status_id:'visited'});assert.equal(r.status,200);assert.equal((await r.json()).version,2);
 assert.equal((await call('/api/places/taipei-101/state','PUT',{...state,version:2,status_id:'invalid'})).status,400);
 assert.equal((await call('/api/places/no-place/state','PUT',state)).status,404);
 assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM state_events').get().n,2);
 // An account with no trip membership must never receive catalog data.
 DB.sqlite.prepare('INSERT INTO users(id,display_name,created_at) VALUES(?,?,?)').run('outsider','Outsider',Date.now());const {sha}=await import('../src/core.mjs');const other='a'.repeat(64);DB.sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await sha(other),'outsider',Date.now()+100000);assert.equal((await call('/api/data','GET',undefined,{Cookie:'tw_session='+other})).status,401);
 // Close/reopen file database to prove data survives process restarts.
 DB.close();DB=openDatabase(resolve(temp,'test.sqlite'));migrate(DB,resolve('drizzle'));env.DB=DB;data=await(await call('/api/data')).json();const saved=data.places.find(p=>p.id==='taipei-101');assert.equal(saved.status_id,'visited');assert.equal(saved.version,2);assert.equal(saved.note,state.note);assert.ok(data.statuses.some(s=>s.id===custom.id));
 const exported=await call('/api/export');assert.equal(exported.status,200);assert.match(exported.headers.get('content-disposition'),/attachment/);assert.ok(!(await exported.text()).includes('password_hash'));
 assert.equal((await call('/api/logout','POST')).status,200);assert.equal((await call('/api/data')).status,401);
 // Keep this check in one rate-limit window, even across a wall-clock boundary.
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 for(let i=0;i<10;i++)assert.equal((await call('/api/login','POST',{password:'wrong'},{},'rate-test')).status,401);
 assert.equal((await call('/api/login','POST',{password:'test-password-only'},{},'rate-test')).status,429);
 t.mock.timers.tick(900000);
 assert.equal((await call('/api/login','POST',{password:'test-password-only'},{},'rate-test')).status,200);
 DB.close();rmSync(temp,{recursive:true,force:true});
});
