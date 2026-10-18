import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../server/database.mjs';
import {handle,passwordHash,sha} from '../src/core.mjs';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {issueSession} from '../src/auth.mjs';

test('additive migration preserves a populated legacy database and accepts the previous 100000-iteration hash',async()=>{
 const DB=openDatabase();try{
  const sql=readFileSync('drizzle/0000_absurd_penance.sql','utf8');DB.sqlite.exec(sql);
  DB.sqlite.exec('CREATE TABLE _app_migrations(name TEXT PRIMARY KEY,hash TEXT NOT NULL,applied_at INTEGER NOT NULL)');
  DB.sqlite.prepare('INSERT INTO _app_migrations VALUES(?,?,?)').run('0000_absurd_penance.sql',createHash('sha256').update(sql).digest('hex'),1);
  DB.sqlite.prepare('INSERT INTO trips VALUES(?,?,?)').run('taiwan-2026','Existing trip','Asia/Taipei');
  DB.sqlite.prepare('INSERT INTO users(id,display_name,created_at) VALUES(?,?,?)').run('trip-shared','Existing user',1);
  DB.sqlite.prepare('INSERT INTO memberships VALUES(?,?,?)').run('taiwan-2026','trip-shared','owner');
  DB.sqlite.prepare('INSERT INTO categories VALUES(?,?,?,?,?)').run('custom','Existing category','#123456','landmark',1);
  DB.sqlite.prepare('INSERT INTO statuses VALUES(?,?,?,?,?,?,?)').run('custom','taiwan-2026','🔥 Хайп!','#123456',1,0,'trip-shared');
  DB.sqlite.prepare('INSERT INTO places VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('existing-place','taiwan-2026','Existing place','','Тайбэй','custom',25,121,'Address','Summary','Tip','{}','2026-10-18',1);
  DB.sqlite.prepare('INSERT INTO user_place_states VALUES(?,?,?,?,?,?)').run('trip-shared','existing-place','custom','Existing note',7,1);
  DB.sqlite.prepare('INSERT INTO state_events VALUES(?,?,?,?,?,?,?)').run('old-event','trip-shared','existing-place','custom','Existing note',7,1);
  DB.sqlite.prepare('INSERT INTO app_meta VALUES(?,?)').run('seed_v1','2026-10-18');
  migrate(DB,'drizzle');migrate(DB,'drizzle');
  const env={DB,APP_ORIGIN:'https://api.example.net',AUTH_MODE:'bearer',APP_PASSWORD_HASH:await passwordHash('legacy-password','1'.repeat(32),100000)};
  const login=await handle(new Request(env.APP_ORIGIN+'/api/login',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({password:'legacy-password'})}),env);
  assert.equal(login.status,200);const {token}=await login.json();
  const data=await(await handle(new Request(env.APP_ORIGIN+'/api/data',{headers:{Authorization:'Bearer '+token}}),env)).json();
  assert.equal(data.places.length,1);assert.equal(data.places[0].note,'Existing note');assert.equal(data.places[0].version,7);assert.equal(data.statuses[0].label,'🔥 Хайп!');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM state_events').get().n,1);
  assert.equal(DB.sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{DB.close()}
});

async function fixture(scope='shared',mode='bearer'){
 const DB=openDatabase();migrate(DB,'drizzle');
 const env={DB,APP_ORIGIN:'https://api.example.net',FRONTEND_ORIGIN:'https://idanpon.github.io',AUTH_MODE:mode,APP_PASSWORD_HASH:await passwordHash('old-shared-password'),TELEGRAM_CLIENT_ID:'123456789'};
 let ip=0;
 const call=(path,method='GET',data,token='',context={})=>handle(new Request(env.APP_ORIGIN+path,{method,headers:{Origin:env.FRONTEND_ORIGIN,...(data!==undefined?{'Content-Type':'application/json'}:{}),...(token?(mode==='bearer'?{Authorization:'Bearer '+token}:{Cookie:'tw_session='+token}):{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),env,{clientIp:'test-'+(++ip),...context});
 const credential=async r=>mode==='bearer'?(await r.json()).token:r.headers.get('set-cookie').match(/tw_session=([^;]+)/)[1];
 const legacy=await credential(await call('/api/login','POST',{password:'old-shared-password'}));
 await call('/api/places/taipei-101/state','PUT',{version:0,status_id:'visited',note:'Existing production note'},legacy);
 const setup=await call('/api/auth/setup','POST',{username:'danil',name:'Danil',password:'new-admin-password',password_confirmation:'new-admin-password',state_scope:scope},legacy);assert.equal(setup.status,200);
 const admin=await credential(setup);
 const add=async(username,role='viewer')=>{
  const r=await call('/api/admin/users','POST',{username,name:username,role,password:'member-password-123',password_confirmation:'member-password-123'},admin);assert.equal(r.status,201);
  const {id}=await r.json(),token=await credential(await call('/api/login','POST',{username:username.toUpperCase(),password:'member-password-123'}));return {id,token};
 };
 return {DB,env,call,admin,legacy,add,credential};
}

test('first admin accepts six-character passwords and rejects short or mismatched confirmation without changing setup',async()=>{
 const DB=openDatabase();migrate(DB,'drizzle');try{
  const env={DB,APP_ORIGIN:'https://api.example.net',AUTH_MODE:'bearer',APP_PASSWORD_HASH:await passwordHash('shared-password')};
  const call=(path,data,token='')=>handle(new Request(env.APP_ORIGIN+path,{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)}),env);
  const {token}=await(await call('/api/login',{password:'shared-password'})).json();
  const setup={name:'Admin',username:'idanpon',state_scope:'shared',password:'abcdef',password_confirmation:'abcdef'};
  for(const invalid of [{password:'abcde',password_confirmation:'abcde'},{password_confirmation:'xxxxxx'},{password_confirmation:undefined}]){
   const r=await call('/api/auth/setup',{...setup,...invalid},token);assert.equal(r.status,400);
   assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM app_meta WHERE key='accounts_v1'").get().n,0);
  }
  assert.equal((await call('/api/auth/setup',setup,token)).status,200);
  assert.equal((await call('/api/login',{username:'idanpon',password:'abcdef'})).status,200);
 }finally{DB.close()}
});

test('admin-created accounts require matching confirmation and allow six-character creation and reset passwords',async()=>{
 const f=await fixture();try{
  const user={name:'Short password',username:'short-user',role:'viewer',password:'abcdef',password_confirmation:'abcdef'};
  for(const invalid of [{password:'abcde',password_confirmation:'abcde'},{password_confirmation:'xxxxxx'},{password_confirmation:undefined}]){
   assert.equal((await f.call('/api/admin/users','POST',{...user,...invalid},f.admin)).status,400);
   assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM users WHERE username=?').get(user.username).n,0);
  }
  const created=await f.call('/api/admin/users','POST',user,f.admin);assert.equal(created.status,201);const {id}=await created.json();
  const login=await f.call('/api/login','POST',{username:user.username,password:'abcdef'});assert.equal(login.status,200);const token=await f.credential(login);
  assert.equal((await f.call('/api/admin/users/'+id,'PUT',{password:'abcde'},f.admin)).status,400);
  assert.equal((await f.call('/api/data','GET',undefined,token)).status,200);
  assert.equal((await f.call('/api/admin/users/'+id,'PUT',{password:'ghijkl'},f.admin)).status,200);
  assert.equal((await f.call('/api/data','GET',undefined,token)).status,401);
  assert.equal((await f.call('/api/login','POST',{username:user.username,password:'ghijkl'})).status,200);
 }finally{f.DB.close()}
});

test('account setup preserves data and history, retires shared password and revokes legacy sessions',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call('/api/data','GET',undefined,f.legacy)).status,401);
  assert.equal((await f.call('/api/login','POST',{password:'old-shared-password'})).status,401);
  assert.equal((await f.call('/api/auth/setup','POST',{},f.admin)).status,409);
  const data=await(await f.call('/api/data','GET',undefined,f.admin)).json();
  assert.equal(data.user.role,'admin');assert.equal(data.user.username,'danil');assert.equal(data.user.can_setup,false);
  assert.equal(data.places.find(p=>p.id==='taipei-101').note,'Existing production note');
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM state_events').get().n,1);
  assert.equal(f.DB.sqlite.prepare('SELECT password_hash FROM users WHERE id=?').get('trip-shared').password_hash.includes('new-admin-password'),false);
  assert.equal((await f.call('/api/auth/config')).status,200);
 }finally{f.DB.close()}
});

test('session issuance rejects credentials that were replaced after verification',async()=>{
 const f=await fixture();try{
  const request=new Request(f.env.APP_ORIGIN+'/api/login');
  await assert.rejects(issueSession(request,f.env,'trip-shared',{legacy:true}),e=>e.status===401);
  const {password_hash}=f.DB.sqlite.prepare('SELECT password_hash FROM users WHERE id=?').get('trip-shared');
  f.DB.sqlite.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await passwordHash('changed-admin-password'),'trip-shared');
  await assert.rejects(issueSession(request,f.env,'trip-shared',{expectedPassword:password_hash}),e=>e.status===401);
 }finally{f.DB.close()}
});

test('viewer cannot mutate; editors share states with conflict detection and identifiable authors; only admin manages users',async()=>{
 const f=await fixture();try{
  const viewer=await f.add('reader'),editor=await f.add('writer','editor');
  assert.equal((await f.call('/api/data','GET',undefined,viewer.token)).status,200);
  assert.equal((await f.call('/api/export','GET',undefined,viewer.token)).status,200);
  for(const [path,method,payload] of [
   ['/api/places/taipei-101/state','PUT',{version:1,status_id:'want',note:'blocked'}],
   ['/api/statuses','POST',{label:'blocked',color:'#123456'}],
   ['/api/admin/users','POST',{username:'hacker',name:'Hacker',password:'hacker-password',role:'admin'}]
  ])assert.equal((await f.call(path,method,payload,viewer.token)).status,403);
  assert.equal((await f.call('/api/admin/users','GET',undefined,editor.token)).status,403);
  assert.equal((await f.call('/api/statuses','POST',{label:'From editor',color:'#123456'},editor.token)).status,201);
  const update={version:1,status_id:'want',note:'Shared edit'};
  assert.equal((await f.call('/api/places/taipei-101/state','PUT',update,editor.token)).status,200);
  assert.equal((await f.call('/api/places/taipei-101/state','PUT',update,f.admin)).status,409);
  const data=await(await f.call('/api/data','GET',undefined,viewer.token)).json();assert.equal(data.places.find(p=>p.id==='taipei-101').note,'Shared edit');
  const event=f.DB.sqlite.prepare('SELECT user_id FROM state_events WHERE version=2').get();assert.equal(event.user_id,editor.id);
  assert.equal(f.DB.sqlite.prepare('SELECT user_id FROM user_place_states WHERE version=2').get().user_id,'trip-shared');
 }finally{f.DB.close()}
});

test('admin changes revoke sessions, prevent last-admin lockout and enforce case-insensitive unique logins',async()=>{
 const f=await fixture();try{
  const editor=await f.add('writer','editor');
  let r=await f.call('/api/admin/users/'+editor.id,'PUT',{disabled:true},f.admin);assert.equal(r.status,200);
  assert.equal((await f.call('/api/data','GET',undefined,editor.token)).status,401);
  assert.equal((await f.call('/api/login','POST',{username:'writer',password:'member-password-123'})).status,401);
  assert.equal((await f.call('/api/admin/users/trip-shared','PUT',{role:'viewer'},f.admin)).status,409);
  assert.equal((await f.call('/api/admin/users/trip-shared','PUT',{disabled:true},f.admin)).status,409);
  assert.equal((await f.call('/api/data','GET',undefined,f.admin)).status,200);
  r=await f.call('/api/admin/users','POST',{name:'Duplicate',username:'DANIL',password:'duplicate-password',password_confirmation:'duplicate-password',role:'viewer'},f.admin);assert.equal(r.status,409);
  assert.equal((await f.call('/api/admin/users/'+editor.id,'PUT',{disabled:false,role:'admin',password:'replacement-password'},f.admin)).status,200);
  assert.equal((await f.call('/api/login','POST',{username:'writer',password:'member-password-123'})).status,401);
  const second=await f.credential(await f.call('/api/login','POST',{username:'writer',password:'replacement-password'}));
  assert.equal((await f.call('/api/admin/users/trip-shared','PUT',{role:'viewer'},second)).status,200);
  assert.equal((await f.call('/api/admin/users','GET',undefined,f.admin)).status,401);
  assert.equal((await f.call('/api/admin/users/'+editor.id,'PUT',{disabled:true},second)).status,409);
 }finally{f.DB.close()}
});

test('cookie transport gives separate accounts access to the same shared records',async()=>{
 const f=await fixture('shared','cookie');try{
  const editor=await f.add('other','editor');
  let data=await(await f.call('/api/data','GET',undefined,editor.token)).json();assert.equal(data.places.find(p=>p.id==='taipei-101').version,1);
  assert.equal((await f.call('/api/places/taipei-101/state','PUT',{version:1,status_id:'want',note:'Shared cookie edit'},editor.token)).status,200);
  data=await(await f.call('/api/data','GET',undefined,f.admin)).json();assert.equal(data.places.find(p=>p.id==='taipei-101').note,'Shared cookie edit');
 }finally{f.DB.close()}
});

test('simultaneous admin demotions cannot remove all active admins',async()=>{
 const f=await fixture();try{
  const second=await f.add('second-admin','admin');
  const results=await Promise.all([
   f.call('/api/admin/users/trip-shared','PUT',{role:'viewer'},second.token),
   f.call('/api/admin/users/'+second.id,'PUT',{role:'viewer'},f.admin)
  ]);
  assert.equal(results.filter(r=>r.status===200).length,1);assert.ok(results.some(r=>[401,403,409].includes(r.status)));
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.role='admin' AND u.disabled=0").get().n,1);
 }finally{f.DB.close()}
});

const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'test-key',alg:'RS256'},keySet=createLocalJWKSet({keys:[jwk]});
async function telegramToken(nonce,claims={},key=pair.privateKey){return new SignJWT({nonce,name:'Telegram Person',...claims}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer(claims.iss||'https://oauth.telegram.org').setAudience(claims.aud||'123456789').setSubject(claims.sub||'987654321').setIssuedAt().setExpirationTime(claims.exp||'5m').sign(key)}
test('Telegram validates signature, issuer, audience, expiry and nonce; requires approval and prevents nonce replay',async()=>{
 const f=await fixture();try{
  const context={telegramKeys:keySet};
  const challenge=async()=>{const r=await f.call('/api/auth/telegram/challenge','POST',{},'',context);assert.equal(r.status,200);return (await r.json()).nonce};
  let nonce=await challenge();
  for(const claims of [{aud:'other-app'},{iss:'https://attacker.example'},{exp:1},{nonce:'wrong-nonce'}]){
   const token=await telegramToken(nonce,claims);assert.equal((await f.call('/api/auth/telegram/login','POST',{nonce,id_token:token},'',context)).status,401);
  }
  const otherPair=await generateKeyPair('RS256');assert.equal((await f.call('/api/auth/telegram/login','POST',{nonce,id_token:await telegramToken(nonce,{},otherPair.privateKey)},'',context)).status,401);
  const id_token=await telegramToken(nonce);assert.equal((await f.call('/api/auth/telegram/login','POST',{nonce,id_token},'',context)).status,403);
  assert.equal((await f.call('/api/auth/telegram/login','POST',{nonce,id_token},'',context)).status,401);
  let listing=await(await f.call('/api/admin/users','GET',undefined,f.admin)).json();assert.equal(listing.requests.length,1);assert.equal(listing.users.length,1);
  const r=await f.call('/api/admin/users','POST',{telegram_request:listing.requests[0].subject,name:'Approved',role:'viewer'},f.admin);assert.equal(r.status,201);
  nonce=await challenge();const login=await f.call('/api/auth/telegram/login','POST',{nonce,id_token:await telegramToken(nonce)},'',context);assert.equal(login.status,200);
  const token=await f.credential(login),data=await(await f.call('/api/data','GET',undefined,token)).json();assert.equal(data.user.role,'viewer');assert.equal(data.user.telegram_linked,true);
  assert.equal((await f.call('/api/places/taipei-101/state','PUT',{version:1,status_id:'want',note:'Blocked'},token)).status,403);
  listing=await(await f.call('/api/admin/users','GET',undefined,f.admin)).json();assert.equal(listing.requests.length,0);assert.ok(!JSON.stringify(listing).includes('password_hash'));
 }finally{f.DB.close()}
});

test('Telegram linking needs a live account and its own challenge; identity cannot be attached to two users',async()=>{
 const f=await fixture();try{
  const editor=await f.add('writer','editor'),context={telegramKeys:keySet};
  let r=await f.call('/api/auth/telegram/challenge','POST',{purpose:'link'},f.admin,context),{nonce}=await r.json();
  const id_token=await telegramToken(nonce);
  assert.equal((await f.call('/api/auth/telegram/link','POST',{nonce,id_token},editor.token,context)).status,403);
  assert.equal((await f.call('/api/auth/telegram/link','POST',{nonce,id_token},f.admin,context)).status,200);
  r=await f.call('/api/auth/telegram/challenge','POST',{purpose:'link'},editor.token,context);nonce=(await r.json()).nonce;
  assert.equal((await f.call('/api/auth/telegram/link','POST',{nonce,id_token:await telegramToken(nonce)},editor.token,context)).status,409);
  r=await f.call('/api/auth/telegram/challenge','POST',{},'',context);nonce=(await r.json()).nonce;
  const token=await f.credential(await f.call('/api/auth/telegram/login','POST',{nonce,id_token:await telegramToken(nonce)},'',context));
  const data=await(await f.call('/api/data','GET',undefined,token)).json();assert.equal(data.user.id,'trip-shared');assert.equal(data.user.role,'admin');
  // Password login still accesses exactly the same account.
  assert.equal((await f.call('/api/login','POST',{username:'danil',password:'new-admin-password'})).status,200);
 }finally{f.DB.close()}
});
