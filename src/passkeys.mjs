import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
import {TRIP,body,fail,json,stmt,session,sessionToken,sha,random,issueSession,limitLogin} from './auth.mjs';

const algorithms=[-7,-257];
export function passkeyConfig(env){
 try{const origin=new URL(env.FRONTEND_ORIGIN||env.APP_ORIGIN).origin,url=new URL(origin);if(url.protocol!=='https:'&&url.hostname!=='localhost')return null;return {origin,rpID:url.hostname}}catch{return null}
}
async function userHandle(id){return Buffer.from(await sha(TRIP+':'+id),'hex')}
async function member(request,env){const user=await session(request,env.DB,env);if(!user)fail(401,'Войдите в аккаунт.');return user}
async function challenge(db,config,purpose,user,token){
 const id=random(),now=Date.now(),value=random();
 await db.batch([stmt(db,'DELETE FROM passkey_challenges WHERE expires_at<?',now),stmt(db,'INSERT INTO passkey_challenges VALUES(?,?,?,?,?,?,?,?)',id,Buffer.from(value).toString('base64url'),purpose,user?.id||null,token?await sha(token):null,config.origin,config.rpID,now+300000)]);
 return {id,value};
}
async function consume(db,id,purpose,config,user,token){
 if(!/^[a-f0-9]{64}$/.test(id||''))fail(400,'Некорректный запрос ключа доступа.');
 const current=await stmt(db,'SELECT * FROM passkey_challenges WHERE id=? AND expires_at>?',id,Date.now()).first();
 if(!current||current.purpose!==purpose||current.origin!==config.origin||current.rp_id!==config.rpID||current.user_id!==(user?.id||null)||current.session_hash!==(token?await sha(token):null))fail(401,'Запрос устарел. Повторите вход.');
 const result=await stmt(db,'DELETE FROM passkey_challenges WHERE id=? AND expires_at>?',id,Date.now()).run();
 if(!result.meta.changes)fail(401,'Запрос уже использован. Повторите вход.');return current.challenge;
}
export async function handlePasskeys(request,env,context={}){
 const path=new URL(request.url).pathname,method=request.method;if(!path.startsWith('/api/auth/passkeys'))return;
 const db=env.DB,config=passkeyConfig(env);if(!config)fail(503,'Ключи доступа недоступны для этого адреса сайта.');
 const listing=path==='/api/auth/passkeys'&&method==='GET',removing=path.match(/^\/api\/auth\/passkeys\/([A-Za-z0-9_-]+)$/);
 if(listing||(removing&&method==='DELETE')){
  const user=await member(request,env);
  if(listing)return json({keys:(await stmt(db,'SELECT id,name,created_at,last_used_at FROM passkeys WHERE user_id=? ORDER BY created_at',user.id).all()).results});
  const currentHash=await sha(sessionToken(request,env));
  const result=await db.batch([stmt(db,'DELETE FROM passkeys WHERE id=? AND user_id=?',removing[1],user.id),stmt(db,'DELETE FROM sessions WHERE user_id=? AND passkey_id=? AND token_hash<>? AND changes()>0',user.id,removing[1],currentHash)]);
  if(!result[0].meta.changes)fail(404,'Ключ не найден.');return json({ok:true});
 }
 if(method!=='POST')fail(404,'Маршрут не найден.');
 const register=path.includes('/register/'),user=register?await member(request,env):null,token=register?sessionToken(request,env):null;
 await limitLogin(db,context,{challenge:true,account:register?'passkey-register:'+user.id:''});
 const b=await body(request,65536);
 if(path==='/api/auth/passkeys/register/options'){
  const row=await stmt(db,'SELECT authenticated_at FROM sessions WHERE token_hash=?',await sha(token)).first();
  if(!row||Date.now()-row.authenticated_at>600000)return json({error:'Для добавления ключа подтвердите вход ещё раз.',details:{code:'reauthenticate'}},403);
  const keys=(await stmt(db,'SELECT id,transports_json FROM passkeys WHERE user_id=?',user.id).all()).results;if(keys.length>=20)fail(409,'Можно добавить до 20 ключей.');
  const c=await challenge(db,config,'register',user,token);
  const options=await generateRegistrationOptions({rpName:'Taiwan Map',rpID:config.rpID,userID:await userHandle(user.id),userName:user.username||user.display_name,userDisplayName:user.display_name,challenge:c.value,timeout:60000,attestationType:'none',supportedAlgorithmIDs:algorithms,authenticatorSelection:{residentKey:'required',userVerification:'required'},excludeCredentials:keys.map(k=>({id:k.id,transports:JSON.parse(k.transports_json)}))});
  return json({challenge_id:c.id,options});
 }
 if(path==='/api/auth/passkeys/register/verify'){
  const expectedChallenge=await consume(db,b.challenge_id,'register',config,user,token);
  let verified;try{verified=await verifyRegistrationResponse({response:b.credential,expectedChallenge,expectedOrigin:config.origin,expectedRPID:config.rpID,requireUserVerification:true,supportedAlgorithmIDs:algorithms})}catch{fail(400,'Не удалось подтвердить ключ доступа. Попробуйте снова.')}
  if(!verified.verified)fail(400,'Не удалось подтвердить ключ доступа.');
  const {credential}=verified.registrationInfo,name=typeof b.name==='string'?b.name.trim().slice(0,80):'Ключ доступа';
  const result=await stmt(db,`INSERT OR IGNORE INTO passkeys(id,user_id,public_key,counter,transports_json,name,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=u.id AND m.trip_id=? WHERE s.token_hash=? AND s.expires_at>? AND u.id=? AND u.disabled=0) AND (SELECT COUNT(*) FROM passkeys WHERE user_id=?)<20`,credential.id,user.id,Buffer.from(credential.publicKey).toString('base64url'),credential.counter,JSON.stringify(credential.transports||[]),name||'Ключ доступа',Date.now(),TRIP,await sha(token),Date.now(),user.id,user.id).run();
  if(!result.meta.changes)fail(409,'Ключ уже добавлен или данные входа изменились.');return json({ok:true},201);
 }
 if(path==='/api/auth/passkeys/login/options'){
  const c=await challenge(db,config,'login');return json({challenge_id:c.id,options:await generateAuthenticationOptions({rpID:config.rpID,challenge:c.value,userVerification:'required',timeout:60000})});
 }
 if(path==='/api/auth/passkeys/login/verify'){
  const expectedChallenge=await consume(db,b.challenge_id,'login',config);
  const key=typeof b.credential?.id==='string'?await stmt(db,'SELECT p.* FROM passkeys p JOIN users u ON u.id=p.user_id JOIN memberships m ON m.user_id=u.id AND m.trip_id=? WHERE p.id=? AND u.disabled=0',TRIP,b.credential.id).first():null;
  if(!key)fail(401,'Ключ не найден или доступ отключён. Используйте пароль или Telegram.');
  if(b.credential.response?.userHandle!==Buffer.from(await userHandle(key.user_id)).toString('base64url'))fail(401,'Ключ относится к другому аккаунту.');
  let verified;try{verified=await verifyAuthenticationResponse({response:b.credential,expectedChallenge,expectedOrigin:config.origin,expectedRPID:config.rpID,requireUserVerification:true,credential:{id:key.id,publicKey:Buffer.from(key.public_key,'base64url'),counter:key.counter,transports:JSON.parse(key.transports_json)}})}catch{fail(401,'Не удалось подтвердить вход с ключом доступа.')}
  if(!verified.verified)fail(401,'Не удалось подтвердить вход.');
  const saved=await stmt(db,'UPDATE passkeys SET counter=?,last_used_at=? WHERE id=? AND counter=?',verified.authenticationInfo.newCounter,Date.now(),key.id,key.counter).run();
  if(!saved.meta.changes)fail(409,'Ключ уже использован другим запросом. Повторите вход.');
  return issueSession(request,env,key.user_id,{expectedPasskey:key.id});
 }
 fail(404,'Маршрут не найден.');
}
