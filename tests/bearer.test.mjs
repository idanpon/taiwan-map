import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../server/database.mjs';
import {handle,passwordHash,sha} from '../src/core.mjs';

test('cross-site bearer sessions support persistence, expiry, revocation and strict CORS without cookies',async()=>{
 const DB=openDatabase();migrate(DB,'drizzle');
 try{
  const origin='https://api.example.net',frontend='https://idanpon.github.io';
  const env={DB,APP_ORIGIN:origin,FRONTEND_ORIGIN:frontend,AUTH_MODE:'bearer',APP_PASSWORD_HASH:await passwordHash('bearer-test-password')};
  const call=(path,method='GET',body,headers={})=>handle(new Request(origin+path,{method,headers:{Origin:frontend,...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env,{clientIp:'bearer-test'});
  let r=await call('/api/data');assert.equal(r.status,401);
  r=await call('/api/login','OPTIONS',undefined,{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type, authorization'});
  assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),frontend);assert.match(r.headers.get('access-control-allow-headers'),/Authorization/);assert.equal(r.headers.get('access-control-allow-credentials'),null);
  assert.equal((await call('/api/data','OPTIONS',undefined,{'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'x-untrusted'})).status,403);
  assert.equal((await call('/api/login','POST',{password:'bearer-test-password'},{Origin:'https://untrusted.example'})).status,403);
  r=await call('/api/login','POST',{password:'wrong'});assert.equal(r.status,401);assert.equal((await r.json()).token,undefined);
  r=await call('/api/login','POST',{password:'bearer-test-password'});assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('cache-control'),'no-store');
  const {token,expires_at}=await r.json();assert.match(token,/^[a-f0-9]{64}$/);assert.ok(expires_at>Date.now());
  const row=DB.sqlite.prepare('SELECT token_hash,expires_at FROM sessions').get();assert.equal(row.token_hash,await sha(token));assert.notEqual(row.token_hash,token);
  const headers={Authorization:'Bearer '+token};
  assert.equal((await call('/api/data','GET',undefined,{Cookie:'tw_session='+token})).status,401);
  for(const malformed of ['Basic '+token,'Bearer '+token+' trailing','Bearer invalid'])assert.equal((await call('/api/data','GET',undefined,{Authorization:malformed})).status,401);
  r=await call('/api/data','GET',undefined,headers);assert.equal(r.status,200);assert.equal((await r.json()).places.length,10);
  r=await call('/api/places/taipei-101/state','PUT',{status_id:'visited',note:'Saved from Pages',version:0},headers);assert.equal(r.status,200);
  r=await call('/api/export','GET',undefined,headers);assert.equal(r.status,200);const exported=await r.json();assert.equal(exported.places.find(p=>p.id==='taipei-101').note,'Saved from Pages');assert.ok(!JSON.stringify(exported).includes(token));
  // A browser from an unapproved origin cannot read even with a valid token.
  assert.equal((await call('/api/data','GET',undefined,{...headers,Origin:'https://untrusted.example'})).status,403);
  DB.sqlite.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(Date.now()-1,await sha(token));
  assert.equal((await call('/api/data','GET',undefined,headers)).status,401);
  DB.sqlite.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(Date.now()+60000,await sha(token));
  r=await call('/api/logout','POST',undefined,headers);assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);
  assert.equal((await call('/api/data','GET',undefined,headers)).status,401);assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM sessions').get().n,0);
 }finally{DB.close()}
});
