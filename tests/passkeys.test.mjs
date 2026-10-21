import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign,randomBytes} from 'node:crypto';
import {isoCBOR} from '@simplewebauthn/server/helpers';
import {openDatabase,migrate} from '../server/database.mjs';
import {handle,passwordHash,sha} from '../src/core.mjs';
const b64=b=>Buffer.from(b).toString('base64url'),hash=b=>createHash('sha256').update(b).digest();
function authenticator(){
 const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),id=randomBytes(32),cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
 function data(options,type,origin='https://map.example'){return Buffer.from(JSON.stringify({type,challenge:options.challenge,origin,crossOrigin:false}))}
 function authData(flags,counter){const count=Buffer.alloc(4);count.writeUInt32BE(counter);return Buffer.concat([hash('map.example'),Buffer.from([flags]),count])}
 return {id:b64(id),register(options,origin){const length=Buffer.alloc(2);length.writeUInt16BE(id.length);return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(data(options,'webauthn.create',origin)),attestationObject:b64(isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',Buffer.concat([authData(69,0),Buffer.alloc(16),length,id,cose])]]))),transports:['internal']}}},login(options,userHandle,{counter=1,origin,flags=5,badSignature=false}={}){const client=data(options,'webauthn.get',origin),auth=authData(flags,counter);return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(client),authenticatorData:b64(auth),signature:b64(badSignature?randomBytes(70):sign('sha256',Buffer.concat([auth,hash(client)]),privateKey)),userHandle}}}};
}
async function fixture(){
 const DB=openDatabase();migrate(DB,'drizzle');const env={DB,APP_ORIGIN:'https://api.example',FRONTEND_ORIGIN:'https://map.example',AUTH_MODE:'bearer',APP_PASSWORD_HASH:await passwordHash('qa-passkey')};
 const call=(path,method='POST',body={},token='')=>handle(new Request(env.APP_ORIGIN+path,{method,headers:{Origin:env.FRONTEND_ORIGIN,...(token?{Authorization:'Bearer '+token}:{}),...(method==='GET'?{}:{'Content-Type':'application/json'})},...(method==='GET'?{}:{body:JSON.stringify(body)})}),env,{clientIp:crypto.randomUUID()});
 const {token}=await(await call('/api/login','POST',{password:'qa-passkey'})).json();DB.sqlite.prepare("INSERT INTO app_meta VALUES('accounts_v1','shared')").run();DB.sqlite.prepare("UPDATE memberships SET role='admin'").run();DB.sqlite.prepare("UPDATE users SET username='owner',password_hash=? WHERE id='trip-shared'").run(env.APP_PASSWORD_HASH);
 return {DB,call,token};
}
test('real signed passkey registration and login, single-use challenges, wrong origin, UV, signatures, handles, counters and revocation',async()=>{
 const {DB,call,token}=await fixture();try{
  const auth=authenticator(),registration=await(await call('/api/auth/passkeys/register/options','POST',{},token)).json();assert.equal(registration.options.rp.id,'map.example');assert.equal(registration.options.authenticatorSelection.residentKey,'required');
  const payload={challenge_id:registration.challenge_id,credential:auth.register(registration.options),name:'Test key'};
  assert.equal((await call('/api/auth/passkeys/register/verify','POST',payload,token)).status,201);assert.equal((await call('/api/auth/passkeys/register/verify','POST',payload,token)).status,401);
  const keys=await(await call('/api/auth/passkeys','GET',undefined,token)).json();assert.equal(keys.keys.length,1);assert.equal(keys.keys[0].public_key,undefined);
  const options=async()=>{const r=await call('/api/auth/passkeys/login/options');assert.equal(r.status,200);return r.json()};
  const verify=async(request,settings={})=>call('/api/auth/passkeys/login/verify','POST',{challenge_id:request.challenge_id,credential:auth.login(request.options,registration.options.user.id,settings)});
  for(const settings of [{origin:'https://evil.example'},{flags:1},{badSignature:true}])assert.equal((await verify(await options(),settings)).status,401);
  let request=await options(),response=await verify(request);assert.equal(response.status,200);const logged=await response.json();assert.match(logged.token,/^[a-f0-9]{64}$/);assert.equal((await verify(request)).status,401);
  assert.equal((await verify(await options(),{counter:1})).status,401);
  request=await options();let wrong=auth.login(request.options,'wrong-handle',{counter:2});assert.equal((await call('/api/auth/passkeys/login/verify','POST',{challenge_id:request.challenge_id,credential:wrong})).status,401);
  DB.sqlite.prepare('UPDATE sessions SET authenticated_at=0 WHERE token_hash=?').run(await sha(token));const stale=await call('/api/auth/passkeys/register/options','POST',{},token);assert.equal(stale.status,403);assert.equal((await stale.json()).details.code,'reauthenticate');
  assert.equal((await call('/api/auth/passkeys/'+auth.id,'DELETE',{},token)).status,200);assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM sessions WHERE passkey_id=?').get(auth.id).n,0);assert.equal((await verify(await options(),{counter:2})).status,401);
 }finally{DB.close()}
});
test('registration requires a current session; expired challenge and disabled member never authenticate',async()=>{
 const {DB,call,token}=await fixture();try{
  assert.equal((await call('/api/auth/passkeys/register/options')).status,401);
  const auth=authenticator(),request=await(await call('/api/auth/passkeys/register/options','POST',{},token)).json();DB.sqlite.prepare('UPDATE passkey_challenges SET expires_at=0').run();
  assert.equal((await call('/api/auth/passkeys/register/verify','POST',{challenge_id:request.challenge_id,credential:auth.register(request.options)},token)).status,401);
  DB.sqlite.prepare('UPDATE users SET disabled=1').run();assert.equal((await call('/api/auth/passkeys/register/options','POST',{},token)).status,401);
 }finally{DB.close()}
});
test('disabling preserves passkeys, while an admin password reset removes keys and sessions atomically',async()=>{
 const {DB,call,token}=await fixture();try{
  const auth=authenticator(),request=await(await call('/api/auth/passkeys/register/options','POST',{},token)).json();
  assert.equal((await call('/api/auth/passkeys/register/verify','POST',{challenge_id:request.challenge_id,credential:auth.register(request.options)},token)).status,201);
  DB.sqlite.prepare('INSERT INTO users(id,display_name,password_hash,username,created_at) VALUES(?,?,?,?,?)').run('admin2','Other Admin',await passwordHash('admin2-password'),'admin2',1);DB.sqlite.prepare("INSERT INTO memberships VALUES('taiwan-2026','admin2','admin')").run();
  const second=(await(await call('/api/login','POST',{username:'admin2',password:'admin2-password'})).json()).token;
  assert.equal((await call('/api/admin/users/trip-shared','PUT',{disabled:true},second)).status,200);assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM passkeys').get().n,1);
  assert.equal((await call('/api/admin/users/trip-shared','PUT',{disabled:false},second)).status,200);
  assert.equal((await call('/api/admin/users/trip-shared','PUT',{username:'owner',password:'reset-pass',password_confirmation:'reset-pass'},second)).status,200);assert.equal(DB.sqlite.prepare('SELECT COUNT(*) n FROM passkeys').get().n,0);assert.equal(DB.sqlite.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id='trip-shared'").get().n,0);
 }finally{DB.close()}
});
