import {createECDH} from 'node:crypto';
import {TRIP,body,fail,json,sha,sessionToken} from './auth.mjs';
import {all,one,run,transaction} from './sqlite.mjs';

const installationPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function webPushKey(value,length){
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))return null;
 const bytes=Buffer.from(value,'base64url');
 return bytes.length===length&&bytes.toString('base64url')===value?bytes:null;
}
export function validPushEndpoint(value){
 if(typeof value!=='string'||value.length>4096)return false;
 try{
  const url=new URL(value),host=url.hostname;
  // Only known Web Push services. No arbitrary URLs, redirects or credentials.
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash&&url.pathname!=='/'&&
   (host==='fcm.googleapis.com'||host.endsWith('.push.apple.com')||host.endsWith('.push.services.mozilla.com')||host.endsWith('.notify.windows.com'));
 }catch{return false}
}
function name(value){
 const result=typeof value==='string'?value.trim():'';
 if(!result||result.length>60||/[\p{Cc}\p{Cf}]/u.test(result))fail(400,'Имя устройства: от 1 до 60 символов.');
 return result;
}
function view(db,user,env){
 const pref=one(db,'SELECT paused FROM notification_preferences WHERE user_id=?',user.id);
 const devices=all(db,`SELECT d.id,d.installation_id,d.name,d.enabled,d.expired,d.last_seen,d.last_sent,d.last_test
  FROM push_devices d JOIN sessions s ON s.token_hash=d.session_hash AND s.user_id=d.user_id
  WHERE d.user_id=? AND s.expires_at>? ORDER BY d.last_seen DESC`,user.id,Date.now())
  .map(d=>({...d,enabled:Boolean(d.enabled),expired:Boolean(d.expired)}));
 return {available:Boolean(env.PUSH),public_key:env.PUSH?.publicKey??null,paused:Boolean(pref?.paused),devices};
}
export function recordPushResult(db,device,result,now){
 if(result==='expired')run(db,'UPDATE push_devices SET expired=1,enabled=0 WHERE id=? AND endpoint=?',device.id,device.endpoint);
 if(result==='sent')run(db,'UPDATE push_devices SET last_sent=? WHERE id=? AND endpoint=?',now,device.id,device.endpoint);
}
export async function handleNotifications(request,env,user){
 const {pathname:path}=new URL(request.url),method=request.method,db=env.DB;
 if(!path.startsWith('/api/notifications'))return null;
 if(path==='/api/notifications'&&method==='GET')return json(view(db,user,env));
 if(path==='/api/notifications/preferences'&&method==='PUT'){
  const b=await body(request);
  if(typeof b.paused!=='boolean')fail(400,'Укажите состояние паузы.');
  run(db,`INSERT INTO notification_preferences(user_id,paused,enabled_from) VALUES(?,?,?)
   ON CONFLICT(user_id) DO UPDATE SET paused=excluded.paused,enabled_from=CASE
    WHEN paused=1 AND excluded.paused=0 THEN excluded.enabled_from ELSE enabled_from END`,
   user.id,Number(b.paused),b.paused?0:Date.now());
  return json(view(db,user,env));
 }
 if(path==='/api/notifications/devices'&&method==='POST'){
  if(!env.PUSH)fail(503,'Отправка пушей пока недоступна.');
  const b=await body(request),installation=b.installation_id,deviceName=name(b.name),s=b.subscription;
  const p256dh=webPushKey(s?.keys?.p256dh,65);
  if(typeof installation!=='string'||!installationPattern.test(installation)||!validPushEndpoint(s?.endpoint)||
   p256dh?.[0]!==4||!webPushKey(s?.keys?.auth,16))fail(400,'Этот браузер не предоставил поддерживаемую подписку.');
  try{const ecdh=createECDH('prime256v1');ecdh.generateKeys();ecdh.computeSecret(p256dh)}
  catch{fail(400,'Некорректный ключ подписки.')}
  const hash=await sha(sessionToken(request,env)),now=Date.now();
  transaction(db,()=>{
   if(!one(db,'SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?',hash,user.id,now))fail(401,'Войдите ещё раз.');
   const previous=one(db,'SELECT * FROM push_devices WHERE user_id=? AND installation_id=?',user.id,installation);
   run(db,'DELETE FROM push_devices WHERE user_id=? AND session_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=?)',user.id,now);
   if(!previous&&one(db,'SELECT COUNT(*) n FROM push_devices WHERE user_id=?',user.id).n>=20){
    const removed=run(db,'DELETE FROM push_devices WHERE id=(SELECT id FROM push_devices WHERE user_id=? AND enabled=0 ORDER BY last_seen LIMIT 1)',user.id);
    if(!removed.changes)fail(400,'Достигнут лимит 20 устройств. Отключите одно из них.');
   }
   run(db,'DELETE FROM push_devices WHERE endpoint=? AND (user_id<>? OR installation_id<>?)',s.endpoint,user.id,installation);
   const same=previous?.enabled&&!previous.expired&&previous.endpoint===s.endpoint&&previous.session_hash===hash&&
    previous.p256dh===s.keys.p256dh&&previous.auth===s.keys.auth;
   run(db,`INSERT INTO push_devices(id,user_id,session_hash,installation_id,name,endpoint,p256dh,auth,enabled_from,last_seen)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,installation_id) DO UPDATE SET
    session_hash=excluded.session_hash,name=excluded.name,endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth=excluded.auth,
    enabled=1,expired=0,enabled_from=excluded.enabled_from,last_seen=excluded.last_seen`,
    previous?.id??crypto.randomUUID(),user.id,hash,installation,deviceName,s.endpoint,s.keys.p256dh,s.keys.auth,same?previous.enabled_from:now,now);
  });
  return json(view(db,user,env));
 }
 const match=path.match(/^\/api\/notifications\/devices\/([0-9a-f-]+)(\/test)?$/);
 if(!match)fail(404,'Настройка уведомлений не найдена.');
 const device=one(db,`SELECT d.* FROM push_devices d JOIN sessions s ON s.token_hash=d.session_hash AND s.user_id=d.user_id
  WHERE d.id=? AND d.user_id=? AND s.expires_at>?`,match[1],user.id,Date.now());
 if(!device)fail(404,'Устройство не найдено.');
 if(!match[2]&&method==='PUT'){
  const b=await body(request);
  // Rename only. Activation always requires subscribing on the device itself.
  run(db,'UPDATE push_devices SET name=? WHERE id=? AND user_id=?',name(b.name),device.id,user.id);
  return json(view(db,user,env));
 }
 if(!match[2]&&method==='DELETE'){
  run(db,'UPDATE push_devices SET enabled=0 WHERE id=? AND user_id=?',device.id,user.id);
  return json(view(db,user,env));
 }
 if(match[2]&&method==='POST'){
  if(!env.PUSH||!device.enabled||device.expired)fail(409,'Сначала подключите устройство.');
  if(one(db,'SELECT paused FROM notification_preferences WHERE user_id=?',user.id)?.paused)fail(409,'Снимите паузу, чтобы отправить тест.');
  const now=Date.now();
  if(one(db,'SELECT 1 FROM push_devices WHERE user_id=? AND last_test>?',user.id,now-60000))fail(429,'Следующий тест можно отправить через минуту.');
  run(db,'UPDATE push_devices SET last_test=? WHERE id=?',now,device.id);
  const result=await env.PUSH.send(device,{title:'Карта Тайваня',body:'Тестовое уведомление',path:'planning.html',tag:'taiwan-test',owner:user.id},60);
  recordPushResult(db,device,result,Date.now());
  if(result==='expired')fail(410,'Подписка истекла. Подключите устройство заново.');
  if(result!=='sent')fail(503,'Не удалось передать тест push-сервису.');
  return json({accepted:true});
 }
 fail(405,'Неизвестное действие.');
}
