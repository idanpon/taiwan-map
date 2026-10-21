import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../server/database.mjs';
import {handle,passwordHash,sha} from '../src/core.mjs';
import {TTL} from '../src/auth.mjs';

test('anonymous catalog is an explicit projection; private notes, hidden places, calendar, exports and all writes stay protected',async()=>{
 const DB=openDatabase();migrate(DB,'drizzle');
 try{
  const env={DB,APP_ORIGIN:'https://map.example',AUTH_MODE:'bearer',APP_PASSWORD_HASH:await passwordHash('qa-public')};
  const call=(path,method='GET',body,token)=>handle(new Request(env.APP_ORIGIN+path,{method,headers:{Origin:env.APP_ORIGIN,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);
  const {token}=await(await call('/api/login','POST',{password:'qa-public'})).json();
  DB.sqlite.prepare("INSERT INTO app_meta VALUES('accounts_v1','shared')").run();DB.sqlite.prepare("UPDATE memberships SET role='admin'").run();
  await call('/api/places/taipei-101/state','PUT',{version:0,status_id:'want',note:'PRIVATE-NOTE-SENTINEL'},token);
  await call('/api/places/simple-kaffa/visibility','PUT',{version:1,hidden:true},token);
  DB.sqlite.exec('ALTER TABLE places ADD COLUMN private_future_column TEXT');DB.sqlite.prepare("UPDATE places SET private_future_column='FUTURE-SECRET'").run();
  const response=await call('/api/public/data'),data=await response.json();assert.equal(response.status,200);assert.equal(data.user,null);assert.equal(data.places.length,9);
  const text=JSON.stringify(data);for(const secret of ['PRIVATE-NOTE-SENTINEL','FUTURE-SECRET','simple-kaffa','state_events','departure_date','created_by'])assert.ok(!text.includes(secret),secret);
  const p=data.places.find(p=>p.id==='taipei-101');assert.equal(p.status_id,'want');assert.ok(p.local_name);assert.ok(p.hours);assert.ok(p.links.length);for(const field of ['note','version','tags_version','visibility_version','hidden','trip_id','updated_at'])assert.equal(Object.hasOwn(p,field),false,field);
  for(const [path,method,body] of [['/api/data','GET'],['/api/export','GET'],['/api/planning','GET'],['/api/places/hidden','GET'],['/api/admin/users','GET'],['/api/places/taipei-101/state','PUT',{}],['/api/places/taipei-101/visibility','PUT',{}],['/api/places/taipei-101','DELETE',{}],['/api/statuses','POST',{}],['/api/planning/items','POST',{}],['/api/auth/passkeys','GET']])assert.equal((await call(path,method,body)).status,401,path);
  DB.sqlite.prepare("INSERT INTO users(id,display_name,created_at) VALUES('viewer','Viewer',1)").run();DB.sqlite.prepare("INSERT INTO memberships VALUES('taiwan-2026','viewer','viewer')").run();const viewer='c'.repeat(64);DB.sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(await sha(viewer),'viewer',Date.now()+100000);
  assert.equal((await call('/api/places/hidden','GET',undefined,viewer)).status,200);assert.equal((await call('/api/export','GET',undefined,viewer)).status,200);assert.equal((await call('/api/planning','GET',undefined,viewer)).status,200);assert.equal((await call('/api/places/taipei-101/state','PUT',{},viewer)).status,403);
  const previous=DB.sqlite.prepare('SELECT authenticated_at FROM sessions WHERE token_hash=?').get(await sha(token)).authenticated_at;
  const renewed=await call('/api/auth/session/refresh','POST',{},token);assert.equal(renewed.status,200);assert.ok((await renewed.json()).expires_at>Date.now()+(TTL-1)*1000);assert.equal(DB.sqlite.prepare('SELECT authenticated_at FROM sessions WHERE token_hash=?').get(await sha(token)).authenticated_at,previous);
  await call('/api/logout','POST',{},token);assert.equal((await call('/api/auth/session/refresh','POST',{},token)).status,401);assert.equal((await call('/api/public/data')).status,200);
 }finally{DB.close()}
});
