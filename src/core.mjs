import { categories, places, verifiedAt } from './places.mjs';
import {TRIP,SHARED_USER as USER,sha,verify,Problem,fail,json,body,stmt,session,sessionToken,cookie,issueSession,limitLogin} from './auth.mjs';
import {handleAccounts,accountScope} from './accounts.mjs';
export {passwordHash,sha} from './auth.mjs';
async function seed(db){
 if(await stmt(db,'SELECT value FROM app_meta WHERE key=?','seed_v1').first())return;
 const now=Date.now();const q=[
 stmt(db,'INSERT OR IGNORE INTO trips(id,name,timezone) VALUES(?,?,?)',TRIP,'Тайвань · 29.12.2026–09.01.2027','Asia/Taipei'),
 stmt(db,'INSERT OR IGNORE INTO users(id,display_name,created_at) VALUES(?,?,?)',USER,'Наша поездка',now),
 stmt(db,'INSERT OR IGNORE INTO memberships(trip_id,user_id,role) VALUES(?,?,?)',TRIP,USER,'owner')
 ];
 for(const c of categories)q.push(stmt(db,'INSERT OR IGNORE INTO categories(id,label,color,icon,sort_order) VALUES(?,?,?,?,?)',c.id,c.label,c.color,c.icon,c.sort_order));
 for(const [i,s] of [['want','Хочу посетить','#b97639'],['visited','Уже посетил','#517c61'],['maybe','Под вопросом','#8c7ba0']].entries())q.push(stmt(db,'INSERT OR IGNORE INTO statuses(id,trip_id,label,color,sort_order,created_by) VALUES(?,?,?,?,?,?)',s[0],TRIP,s[1],s[2],i,USER));
 for(const p of places){
  q.push(stmt(db,'INSERT OR IGNORE INTO places(id,trip_id,name,local_name,city,category_id,lat,lon,address,summary,tip,hours_json,verified_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',p.id,TRIP,p.name,p.local_name,p.city,p.category_id,p.lat,p.lon,p.address,p.summary,p.tip,JSON.stringify(p.hours),p.verified_at,now));
  q.push(stmt(db,'INSERT OR IGNORE INTO place_links(id,place_id,label,url,kind) VALUES(?,?,?,?,?)',p.id+'-source',p.id,'Источник часов',p.source,'source'));
  if(p.extra)q.push(stmt(db,'INSERT OR IGNORE INTO place_links(id,place_id,label,url,kind) VALUES(?,?,?,?,?)',p.id+'-extra',p.id,p.extra[0],p.extra[1],'official'));
 }
 q.push(stmt(db,'INSERT OR IGNORE INTO app_meta(key,value) VALUES(?,?)','seed_v1',verifiedAt));await db.batch(q);
}
async function handleApi(request,env,context={}){
 try {
 const url=new URL(request.url),db=env.DB,path=url.pathname;const secure=url.protocol==='https:';
 if(!db)fail(503,'Хранилище временно недоступно.');
 if(path==='/api/health'&&request.method==='GET'){await db.prepare('SELECT 1').first();return json({ok:true})}
 if(!['GET','HEAD'].includes(request.method)){
  if(!allowedOrigins(env,url).has(request.headers.get('origin')))fail(403,'Источник запроса не разрешён.');
 }
 const accountResponse=await handleAccounts(request,env,context);if(accountResponse)return accountResponse;
 if(path==='/api/login'&&request.method==='POST'){
  if(!env.APP_PASSWORD_HASH)fail(503,'Авторизация не настроена.');
  const b=await body(request);if(typeof b.password!=='string'||b.password.length>256)fail(400,'Укажите пароль.');
  await limitLogin(db,context,{legacy:true});
  if(!await verify(b.password,env.APP_PASSWORD_HASH))fail(401,'Неверный пароль.');
  await seed(db);return await issueSession(request,env,USER,{legacy:true});
 }
 const user=await session(request,db,env);if(!user)fail(401,'Войдите, чтобы открыть карту.');
 if(path==='/api/logout'&&request.method==='POST'){
  const token=sessionToken(request,env);if(token)await stmt(db,'DELETE FROM sessions WHERE token_hash=?',await sha(token)).run();
  return json({ok:true},200,env.AUTH_MODE==='bearer'?{}:{'Set-Cookie':cookie('',secure,0,env.SESSION_COOKIE_PATH||'/')});
 }
 const scope=await accountScope(db),stateUser=scope==='shared'?USER:user.id;
 if((path==='/api/data'||path==='/api/export')&&request.method==='GET'){
  const [ps,cs,ss,ls]=await db.batch([
   stmt(db,`SELECT p.*,s.status_id,s.note,COALESCE(s.version,0) version FROM places p LEFT JOIN user_place_states s ON s.place_id=p.id AND s.user_id=? WHERE p.trip_id=? ORDER BY p.city,p.name`,stateUser,TRIP),
   db.prepare('SELECT * FROM categories ORDER BY sort_order'),stmt(db,'SELECT id,label,color,sort_order FROM statuses WHERE trip_id=? AND archived=0 ORDER BY sort_order,label',TRIP),stmt(db,'SELECT l.* FROM place_links l JOIN places p ON p.id=l.place_id WHERE p.trip_id=?',TRIP)
  ]);
  const data={schema_version:1,trip:{id:TRIP,name:'Тайвань',timezone:'Asia/Taipei'},state_scope:scope||'shared',user:{id:user.id,name:user.display_name,username:user.username,role:user.role==='owner'?'admin':user.role,telegram_linked:Boolean(user.auth_subject),has_password:Boolean(user.has_password),can_setup:!scope&&user.role==='owner'},verified_at:verifiedAt,categories:cs.results,statuses:ss.results,places:ps.results.map(p=>({...p,hours:JSON.parse(p.hours_json),hours_json:undefined,note:p.note||'',links:ls.results.filter(l=>l.place_id===p.id)}))};
  return json(data,200,path==='/api/export'?{'Content-Disposition':'attachment; filename="taiwan-map.json"'}:{});
 }
 if(path==='/api/statuses'&&request.method==='POST'){
  if(!['owner','admin','editor'].includes(user.role))fail(403,'Нужны права редактирования.');const b=await body(request);
  const label=typeof b.label==='string'?b.label.trim():'';if(!label||label.length>40||!/^#[0-9a-f]{6}$/i.test(b.color||''))fail(400,'Название: 1–40 символов; цвет: #RRGGBB.');
  const id=crypto.randomUUID();
  const created=await stmt(db,`INSERT INTO statuses(id,trip_id,label,color,sort_order,created_by) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM statuses WHERE trip_id=? AND archived=0)<100 AND NOT EXISTS (SELECT 1 FROM statuses WHERE trip_id=? AND label=? AND archived=0)`,id,TRIP,label,b.color,Date.now(),user.id,TRIP,TRIP,label).run();
  if(!created.meta.changes)fail(409,'Такой статус уже есть или достигнут лимит 100 статусов.');return json({id,label,color:b.color},201);
 }
 const match=path.match(/^\/api\/places\/([a-zA-Z0-9-]+)\/state$/);
 if(match&&request.method==='PUT'){
  if(!['owner','admin','editor'].includes(user.role))fail(403,'Доступ только для просмотра.');
  const place=await stmt(db,'SELECT id FROM places WHERE id=? AND trip_id=?',match[1],TRIP).first();if(!place)fail(404,'Место не найдено.');
  const b=await body(request);if(!Number.isSafeInteger(b.version)||b.version<0||typeof b.note!=='string'||b.note.length>2000)fail(400,'Некорректная версия или заметка (до 2000 символов).');
  if(b.status_id!==null&&(typeof b.status_id!=='string'||!await stmt(db,'SELECT id FROM statuses WHERE id=? AND trip_id=? AND archived=0',b.status_id,TRIP).first()))fail(400,'Неизвестный статус.');
  const now=Date.now(),next=b.version+1,eventId=crypto.randomUUID();
  const result=await db.batch([
   b.version===0 ? stmt(db,'INSERT OR IGNORE INTO user_place_states(user_id,place_id,status_id,note,version,updated_at) VALUES(?,?,?,?,1,?)',stateUser,place.id,b.status_id,b.note,now) : stmt(db,'UPDATE user_place_states SET status_id=?,note=?,version=version+1,updated_at=? WHERE user_id=? AND place_id=? AND version=?',b.status_id,b.note,now,stateUser,place.id,b.version),
   stmt(db,`INSERT INTO state_events(id,user_id,place_id,status_id,note,version,created_at) SELECT ?,?,place_id,status_id,note,version,? FROM user_place_states WHERE user_id=? AND place_id=? AND version=? AND changes()=1`,eventId,user.id,now,stateUser,place.id,next)
  ]);
  if(!result[0].meta.changes)fail(409,'Место изменили на другом устройстве. Обновите данные и повторите.');return json({version:next,updated_at:now});
 }
 fail(404,'Маршрут не найден.');
 }catch(error){if(error instanceof Problem)return json({error:error.message},error.status,error.status===429?{'Retry-After':'900'}:{});console.error('API failure',error?.name);return json({error:'Не удалось выполнить запрос. Попробуйте ещё раз.'},500)}
}

// CORS stays at the transport boundary; authentication and membership still apply.
function allowedOrigins(env,url){
 const origins=new Set([env.APP_ORIGIN||url.origin]);
 if(env.FRONTEND_ORIGIN)origins.add(env.FRONTEND_ORIGIN);
 return origins;
}
export async function handle(request,env,context={}){
 const url=new URL(request.url),origin=request.headers.get('origin'),allowed=allowedOrigins(env,url);
 if(origin&&!allowed.has(origin))return json({error:'Источник запроса не разрешён.'},403,{'Vary':'Origin'});
 let response;
 if(request.method==='OPTIONS'){
  const method=request.headers.get('access-control-request-method');
  const requested=(request.headers.get('access-control-request-headers')||'').split(',').map(h=>h.trim().toLowerCase()).filter(Boolean);
  const allowedHeaders=env.AUTH_MODE==='bearer'?['content-type','authorization']:['content-type'];
  if(!origin||!['GET','POST','PUT','DELETE'].includes(method)||requested.some(h=>!allowedHeaders.includes(h)))return json({error:'Preflight не разрешён.'},403,{'Vary':'Origin'});
  response=new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET, POST, PUT, DELETE','Access-Control-Allow-Headers':env.AUTH_MODE==='bearer'?'Content-Type, Authorization':'Content-Type','Access-Control-Max-Age':'600','Cache-Control':'no-store'}});
 }else response=await handleApi(request,env,context);
 const headers=new Headers(response.headers);headers.set('Vary','Origin');
 if(origin){headers.set('Access-Control-Allow-Origin',origin);if(env.AUTH_MODE!=='bearer')headers.set('Access-Control-Allow-Credentials','true');headers.set('Access-Control-Expose-Headers','Content-Disposition')}
 return new Response(response.body,{status:response.status,headers});
}
