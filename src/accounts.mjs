import {TRIP,SHARED_USER,body,fail,json,stmt,session,sessionToken,sha,random,passwordHash,verify,issueSession,limitLogin} from './auth.mjs';
import {verifyTelegram} from './telegram.mjs';
export const roles=['admin','editor','viewer'];
export async function accountScope(db){return (await stmt(db,'SELECT value FROM app_meta WHERE key=?','accounts_v1').first())?.value||null}
const dummyHash='pbkdf2$600000$'+'0'.repeat(32)+'$'+'0'.repeat(64);
function username(value){const name=typeof value==='string'?value.trim().toLowerCase():'';if(!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(name))fail(400,'Логин: 3–40 латинских букв, цифр, точек, дефисов или подчёркиваний.');return name}
function displayName(value){if(typeof value!=='string'||!value.trim()||value.trim().length>80)fail(400,'Имя: 1–80 символов.');return value.trim()}
function password(value){if(typeof value!=='string'||value.length<6||value.length>256)fail(400,'Пароль: от 6 до 256 символов.');return value}
function newPassword(b){const value=password(b.password);if(b.password_confirmation!==value)fail(400,'Пароли не совпадают.');return value}
function role(value){if(!roles.includes(value))fail(400,'Неизвестная роль.');return value}
async function requireUser(request,env){const user=await session(request,env.DB,env);if(!user)fail(401,'Войдите, чтобы открыть карту.');return user}
async function requireAdmin(request,env){const user=await requireUser(request,env);if(user.role!=='admin')fail(403,'Нужны права admin.');return user}
const telegramClientId=env=>/^\d{1,30}$/.test(env.TELEGRAM_CLIENT_ID||'')?env.TELEGRAM_CLIENT_ID:null;

export async function handleAccounts(request,env,context={}){
 const db=env.DB,path=new URL(request.url).pathname,method=request.method;
 if(!['/api/login','/api/auth/config','/api/auth/setup','/api/auth/password'].includes(path)&&!path.startsWith('/api/auth/telegram/')&&!path.startsWith('/api/admin/'))return;
 const scope=await accountScope(db);
 if(path==='/api/auth/config'&&method==='GET')return json({mode:scope?'accounts':'shared',state_scope:scope,telegram_client_id:scope?telegramClientId(env):null});
 if(path==='/api/auth/setup'&&method==='POST'){
  if(scope)fail(409,'Учётные записи уже настроены.');
  const actor=await requireUser(request,env);if(actor.id!==SHARED_USER||actor.role!=='owner')fail(403,'Нужен вход с текущим паролем поездки.');
  const b=await body(request),login=username(b.username),name=displayName(b.name),hash=await passwordHash(newPassword(b));
  if(b.state_scope!=='shared')fail(400,'Для поездки используется общая карта.');
  try{await db.batch([
   stmt(db,'INSERT INTO app_meta(key,value) VALUES(?,?)','accounts_v1',b.state_scope),
   stmt(db,'UPDATE users SET username=?,display_name=?,password_hash=? WHERE id=?',login,name,hash,SHARED_USER),
   stmt(db,'UPDATE memberships SET role=? WHERE trip_id=? AND user_id=?','admin',TRIP,SHARED_USER),
   db.prepare('DELETE FROM sessions')
  ])}catch(error){if(await accountScope(db))fail(409,'Учётные записи уже настроены.');throw error}
  return issueSession(request,env,SHARED_USER,{expectedPassword:hash});
 }
 if(path==='/api/login'&&method==='POST'){
  if(!scope)return;
  const b=await body(request),login=typeof b.username==='string'?b.username.trim().toLowerCase():'';
  if(login.length>40||typeof b.password!=='string'||b.password.length>256)fail(400,'Укажите логин и пароль.');
  await limitLogin(db,context,{account:'password:'+login});
  const user=await stmt(db,'SELECT u.id,u.password_hash,u.disabled,m.role FROM users u LEFT JOIN memberships m ON m.user_id=u.id AND m.trip_id=? WHERE u.username=? COLLATE NOCASE',TRIP,login).first();
  const valid=await verify(b.password,user?.password_hash||dummyHash);
  if(!valid||!user||user.disabled||!roles.includes(user.role))fail(401,'Неверный логин или пароль.');
  return issueSession(request,env,user.id,{expectedPassword:user.password_hash});
 }
 if(!scope)fail(409,'Сначала настройте учётную запись admin.');
 if(path==='/api/auth/password'&&method==='POST'){
  const actor=await requireUser(request,env),b=await body(request);
  const value=newPassword(b),current=await stmt(db,'SELECT password_hash FROM users WHERE id=?',actor.id).first();
  await limitLogin(db,context,{account:'password-change:'+actor.id});
  if(current.password_hash&&(typeof b.current_password!=='string'||b.current_password.length>256||!await verify(b.current_password,current.password_hash)))fail(400,'Неверный текущий пароль.');
  const login=actor.username||username(b.username),hash=await passwordHash(value),tokenHash=await sha(sessionToken(request,env));
  let result;try{result=await db.batch([
   stmt(db,`UPDATE users SET password_hash=?,username=? WHERE id=? AND disabled=0 AND password_hash IS ? AND EXISTS (SELECT 1 FROM sessions WHERE user_id=? AND token_hash=? AND expires_at>?) AND EXISTS (SELECT 1 FROM memberships WHERE trip_id=? AND user_id=?)`,hash,login,actor.id,current.password_hash,actor.id,tokenHash,Date.now(),TRIP,actor.id),
   stmt(db,'DELETE FROM sessions WHERE user_id=? AND changes()=1',actor.id)
  ])}catch(error){if(String(error.message).includes('UNIQUE'))fail(409,'Этот логин уже используется.');throw error}
  if(!result[0].meta.changes)fail(409,'Данные входа изменились. Войдите снова.');
  return json({ok:true,reauthenticate:true});
 }
 if(path==='/api/auth/telegram/challenge'&&method==='POST'){
  if(!telegramClientId(env))fail(503,'Вход через Telegram ещё не подключён.');
  const b=await body(request),purpose=b.purpose||'login';if(!['login','link'].includes(purpose))fail(400,'Некорректное назначение входа.');
  const actor=purpose==='link'?await requireUser(request,env):null;
  await limitLogin(db,context,{challenge:true});
  const nonce=random(),now=Date.now();await db.batch([
   stmt(db,'DELETE FROM auth_challenges WHERE expires_at<?',now),
   stmt(db,'INSERT INTO auth_challenges VALUES(?,?,?,?)',await sha(nonce),purpose,actor?.id||null,now+300000)
  ]);return json({nonce});
 }
 if(['/api/auth/telegram/login','/api/auth/telegram/link'].includes(path)&&method==='POST'){
  const clientId=telegramClientId(env);if(!clientId)fail(503,'Вход через Telegram ещё не подключён.');
  const linking=path.endsWith('/link'),actor=linking?await requireUser(request,env):null;
  const b=await body(request);if(typeof b.id_token!=='string'||b.id_token.length>7000||!/^\w{64}$/.test(b.nonce||''))fail(400,'Некорректный ответ Telegram.');
  await limitLogin(db,context);
  const challenge=await stmt(db,'SELECT purpose,user_id FROM auth_challenges WHERE nonce_hash=? AND expires_at>?',await sha(b.nonce),Date.now()).first();
  if(!challenge||challenge.purpose!==(linking?'link':'login')||challenge.user_id!==(actor?.id||null))fail(linking?403:401,'Вход устарел. Повторите попытку.');
  let identity;try{identity=await verifyTelegram(b.id_token,b.nonce,clientId,context.telegramKeys)}catch{fail(linking?403:401,'Не удалось подтвердить вход через Telegram.');}
  const consumed=await stmt(db,'DELETE FROM auth_challenges WHERE nonce_hash=? AND expires_at>?',await sha(b.nonce),Date.now()).run();
  if(!consumed.meta.changes)fail(linking?403:401,'Этот вход уже использован. Повторите попытку.');
  const subject='telegram:'+identity.subject;
  if(linking){
   if(actor.auth_subject&&actor.auth_subject!==subject)fail(409,'К учётной записи уже привязан другой Telegram.');
   const other=await stmt(db,'SELECT id FROM users WHERE auth_subject=?',subject).first();if(other&&other.id!==actor.id)fail(409,'Этот Telegram уже привязан к другой учётной записи.');
   let linked;try{linked=await db.batch([stmt(db,'UPDATE users SET auth_subject=? WHERE id=? AND disabled=0 AND (auth_subject IS NULL OR auth_subject=?)',subject,actor.id,subject),stmt(db,'DELETE FROM telegram_requests WHERE subject=? AND changes()=1',subject)])}catch{fail(409,'Этот Telegram уже привязан к другой учётной записи.');}
   if(!linked[0].meta.changes)fail(409,'Привязка аккаунта изменилась. Обновите страницу.');
   return json({ok:true});
  }
  const user=await stmt(db,'SELECT u.id,u.disabled,m.role FROM users u LEFT JOIN memberships m ON m.user_id=u.id AND m.trip_id=? WHERE u.auth_subject=?',TRIP,subject).first();
  if(user){if(user.disabled||!roles.includes(user.role))fail(403,'Доступ к поездке отключён. Обратитесь к admin.');return issueSession(request,env,user.id,{expectedSubject:subject})}
  const pending=await stmt(db,`INSERT OR IGNORE INTO telegram_requests(subject,display_name,created_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM telegram_requests)<200`,subject,identity.name,Date.now()).run();
  if(!pending.meta.changes&&!await stmt(db,'SELECT subject FROM telegram_requests WHERE subject=?',subject).first())fail(503,'Слишком много заявок. Обратитесь к admin.');
  fail(403,'Заявка на доступ отправлена. Дождитесь одобрения admin и войдите снова.');
 }
 if(path.startsWith('/api/admin/')){
  const actor=await requireAdmin(request,env);
  if(path==='/api/admin/users'&&method==='GET'){
   const [users,requests]=await db.batch([
    stmt(db,'SELECT u.id,u.display_name name,u.username,u.disabled,u.auth_subject IS NOT NULL telegram_linked,m.role,u.created_at FROM users u JOIN memberships m ON m.user_id=u.id AND m.trip_id=? ORDER BY u.created_at,u.id',TRIP),
    db.prepare('SELECT subject,display_name name,created_at FROM telegram_requests ORDER BY created_at')
   ]);return json({users:users.results,requests:requests.results});
  }
  if(path==='/api/admin/users'&&method==='POST'){
   const b=await body(request),name=displayName(b.name),newRole=role(b.role);
   if((await stmt(db,'SELECT COUNT(*) n FROM memberships WHERE trip_id=?',TRIP).first()).n>=500)fail(409,'Достигнут лимит учётных записей.');
   let login=null,hash=null,subject=null;
   if(b.telegram_request){
    const pending=await stmt(db,'SELECT subject FROM telegram_requests WHERE subject=?',String(b.telegram_request)).first();if(!pending)fail(404,'Заявка не найдена.');subject=pending.subject;
   }
   if(b.username||b.password){login=username(b.username);hash=await passwordHash(newPassword(b))}
   if(!subject&&!login)fail(400,'Нужен логин и пароль либо заявка Telegram.');
   const id=crypto.randomUUID(),queries=[stmt(db,'INSERT INTO users(id,display_name,username,password_hash,auth_subject,created_at) VALUES(?,?,?,?,?,?)',id,name,login,hash,subject,Date.now()),stmt(db,'INSERT INTO memberships VALUES(?,?,?)',TRIP,id,newRole)];
   if(subject)queries.push(stmt(db,'DELETE FROM telegram_requests WHERE subject=?',subject));
   try{await db.batch(queries)}catch(error){if(String(error.message).includes('UNIQUE'))fail(409,'Этот логин или Telegram уже используется.');throw error}
   return json({id},201);
  }
  const match=path.match(/^\/api\/admin\/users\/([a-zA-Z0-9-]+)$/);
  if(match&&method==='PUT'){
   const current=await stmt(db,'SELECT u.*,m.role FROM users u JOIN memberships m ON m.user_id=u.id AND m.trip_id=? WHERE u.id=?',TRIP,match[1]).first();if(!current)fail(404,'Пользователь не найден.');
   const b=await body(request),name=b.name===undefined?current.display_name:displayName(b.name),newRole=b.role===undefined?current.role:role(b.role);
   if(b.disabled!==undefined&&typeof b.disabled!=='boolean')fail(400,'Некорректное состояние доступа.');
   const disabled=b.disabled===undefined?current.disabled:Number(b.disabled);
   if(actor.id===current.id&&disabled)fail(409,'Нельзя отключить свой аккаунт.');
   const login=b.username===undefined?current.username:username(b.username),hash=b.password===undefined?current.password_hash:await passwordHash(newPassword(b));
   if((login&&!hash)||(!current.auth_subject&&(!login||!hash)))fail(400,'Для входа по логину нужен пароль.');
   let result;try{result=await db.batch([
    stmt(db,`UPDATE memberships SET role=? WHERE trip_id=? AND user_id=? AND role=? AND EXISTS (SELECT 1 FROM users target WHERE target.id=? AND target.password_hash IS ? AND target.disabled=? AND target.username IS ? AND target.display_name=? AND target.auth_subject IS ?) AND EXISTS (SELECT 1 FROM memberships am JOIN users a ON a.id=am.user_id WHERE am.trip_id=? AND am.user_id=? AND am.role='admin' AND a.disabled=0) AND ((?='admin' AND ?=0) OR role<>'admin' OR EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.trip_id=? AND m.role='admin' AND u.disabled=0 AND m.user_id<>?))`,newRole,TRIP,current.id,current.role,current.id,current.password_hash,current.disabled,current.username,current.display_name,current.auth_subject,TRIP,actor.id,newRole,disabled,TRIP,current.id),
    stmt(db,'UPDATE users SET display_name=?,username=?,password_hash=?,disabled=? WHERE id=? AND changes()=1',name,login,hash,disabled,current.id),
    stmt(db,'DELETE FROM sessions WHERE user_id=? AND changes()=1',current.id)
   ])}catch(error){if(String(error.message).includes('UNIQUE'))fail(409,'Этот логин уже используется.');throw error}
   if(!result[0].meta.changes)fail(409,'Изменения не сохранены: нельзя отключить или понизить последнего активного admin, либо данные аккаунта изменились. Обновите список.');
   return json({ok:true,reauthenticate:actor.id===current.id});
  }
  if(match&&method==='DELETE'){
   if(match[1]===actor.id)fail(409,'Нельзя удалить свой аккаунт.');
   const current=await stmt(db,'SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id AND m.trip_id=? WHERE u.id=?',TRIP,match[1]).first();if(!current)fail(404,'Пользователь не найден.');
   // Retain the identity row for map history and the shared state owner, but
   // erase credentials and membership. Deleting an account never deletes trip data.
   const result=await db.batch([
    stmt(db,`DELETE FROM memberships WHERE trip_id=? AND user_id=? AND EXISTS (SELECT 1 FROM memberships am JOIN users a ON a.id=am.user_id WHERE am.trip_id=? AND am.user_id=? AND am.role='admin' AND a.disabled=0) AND (role<>'admin' OR EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.trip_id=? AND m.role='admin' AND u.disabled=0 AND m.user_id<>?))`,TRIP,current.id,TRIP,actor.id,TRIP,current.id),
    stmt(db,`UPDATE users SET display_name='Удалённый пользователь',username=NULL,password_hash=NULL,auth_subject=NULL,disabled=1 WHERE id=? AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=?)`,current.id,current.id),
    stmt(db,'DELETE FROM sessions WHERE user_id=? AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=?)',current.id,current.id),
    stmt(db,'DELETE FROM auth_challenges WHERE user_id=? AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=?)',current.id,current.id)
   ]);
   if(!result[0].meta.changes)fail(409,'Нельзя удалить последнего активного admin. Обновите список пользователей.');
   return json({ok:true});
  }
  if(path==='/api/admin/telegram-requests/reject'&&method==='POST'){
   const b=await body(request);await stmt(db,'DELETE FROM telegram_requests WHERE subject=?',String(b.subject||'')).run();return json({ok:true});
  }
 }
 fail(404,'Маршрут не найден.');
}
