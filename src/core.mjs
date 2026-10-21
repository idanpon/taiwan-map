import {handlePlanning,planningData,guardPlanningStatus} from './planning.mjs';
import {readTags,mergeTags} from '../public/place-tags.js';
import {handlePlaceTags} from './place-tags.mjs';
import { categories, places, verifiedAt } from './places.mjs';
import {TRIP,SHARED_USER as USER,sha,verify,Problem,fail,json,body,stmt,session,sessionToken,cookie,issueSession,limitLogin} from './auth.mjs';
import {handleAccounts,accountScope} from './accounts.mjs';
import {validStatusSymbol} from '../public/map-model.js';
import {handlePlaceLifecycle} from './place-lifecycle.mjs';
import {handlePasskeys} from './passkeys.mjs';
import {publicCatalog} from './public-catalog.mjs';
export {passwordHash,sha} from './auth.mjs';
async function seed(db){
 if(await stmt(db,'SELECT value FROM app_meta WHERE key=?','seed_v1').first())return;
 const now=Date.now();const q=[
 stmt(db,'INSERT OR IGNORE INTO trips(id,name,timezone) VALUES(?,?,?)',TRIP,'Тайвань · 29.12.2026–09.01.2027','Asia/Taipei'),
 stmt(db,'INSERT OR IGNORE INTO users(id,display_name,created_at) VALUES(?,?,?)',USER,'Наша поездка',now),
 stmt(db,'INSERT OR IGNORE INTO memberships(trip_id,user_id,role) VALUES(?,?,?)',TRIP,USER,'owner')
 ];
 for(const c of categories)q.push(stmt(db,'INSERT OR IGNORE INTO categories(id,label,color,icon,sort_order) VALUES(?,?,?,?,?)',c.id,c.label,c.color,c.icon,c.sort_order));
 for(const [i,s] of [['want','Хочу посетить','#1456e0','!',0],['visited','Уже посетил','#6b7280','✓',1],['maybe','Под вопросом','#facc15','?',0]].entries())q.push(stmt(db,'INSERT OR IGNORE INTO statuses(id,trip_id,label,color,sort_order,created_by,symbol,dimmed) VALUES(?,?,?,?,?,?,?,?)',s[0],TRIP,s[1],s[2],i,USER,s[3],s[4]));
 for(const p of places){
  q.push(stmt(db,'INSERT OR IGNORE INTO places(id,trip_id,name,local_name,city,category_id,lat,lon,address,summary,tip,hours_json,verified_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',p.id,TRIP,p.name,p.local_name,p.city,p.category_id,p.lat,p.lon,p.address,p.summary,p.tip,JSON.stringify(p.hours),p.verified_at,now));
  q.push(stmt(db,'INSERT OR IGNORE INTO place_links(id,place_id,label,url,kind) VALUES(?,?,?,?,?)',p.id+'-source',p.id,'Источник часов',p.source,'source'));
  if(p.extra)q.push(stmt(db,'INSERT OR IGNORE INTO place_links(id,place_id,label,url,kind) VALUES(?,?,?,?,?)',p.id+'-extra',p.id,p.extra[0],p.extra[1],'official'));
 }
 if(db.sqlite?.prepare('PRAGMA table_info(trips)').all().some(c=>c.name==='departure_date'))q.push(stmt(db,"UPDATE trips SET departure_date=COALESCE(departure_date,'2026-12-28'),start_date=COALESCE(start_date,'2026-12-29'),end_date=COALESCE(end_date,'2027-01-09') WHERE id=?",TRIP));
 q.push(stmt(db,'INSERT OR IGNORE INTO app_meta(key,value) VALUES(?,?)','seed_v1',verifiedAt));await db.batch(q);
}
async function handleApi(request,env,context={}){
 try {
 const url=new URL(request.url),db=env.DB,path=url.pathname;const secure=url.protocol==='https:';
 if(!db)fail(503,'Хранилище временно недоступно.');
 if(path==='/api/health'&&request.method==='GET'){await db.prepare('SELECT 1').first();return json({ok:true})}
 if(path==='/api/public/data'&&request.method==='GET')return await publicCatalog(db);
 if(!['GET','HEAD'].includes(request.method)){
  if(!allowedOrigins(env,url).has(request.headers.get('origin')))fail(403,'Источник запроса не разрешён.');
 }
 const passkeyResponse=await handlePasskeys(request,env,context);if(passkeyResponse)return passkeyResponse;
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
 const planningResponse=await handlePlanning(request,db,user);if(planningResponse)return planningResponse;
 const tagResponse=await handlePlaceTags(request,db,user);if(tagResponse)return tagResponse;
 const lifecycle=await handlePlaceLifecycle(request,db,user,stateUser);if(lifecycle)return lifecycle;
 if((path==='/api/data'||path==='/api/export')&&request.method==='GET'){
  const [ps,cs,ss,ls]=await db.batch([
   stmt(db,`SELECT p.*,s.status_id,s.note,COALESCE(s.version,0) version FROM places p LEFT JOIN user_place_states s ON s.place_id=p.id AND s.user_id=? WHERE p.trip_id=? ${path==='/api/data'?'AND p.hidden=0':''} ORDER BY p.city,p.name`,stateUser,TRIP),
   db.prepare('SELECT * FROM categories ORDER BY sort_order'),stmt(db,'SELECT id,label,color,symbol,dimmed,version,sort_order FROM statuses WHERE trip_id=? AND archived=0 ORDER BY sort_order,label',TRIP),stmt(db,'SELECT l.* FROM place_links l JOIN places p ON p.id=l.place_id WHERE p.trip_id=?',TRIP)
  ]);
  const data={schema_version:1,trip:{id:TRIP,name:'Тайвань',timezone:'Asia/Taipei'},state_scope:scope||'shared',user:{id:user.id,name:user.display_name,username:user.username,role:user.role==='owner'?'admin':user.role,telegram_linked:Boolean(user.auth_subject),has_password:Boolean(user.has_password),can_setup:!scope&&user.role==='owner'},verified_at:verifiedAt,categories:cs.results.map(c=>({...c,description:categories.find(definition=>definition.id===c.id)?.description||''})),statuses:ss.results.map(s=>({...s,dimmed:Boolean(s.dimmed)})),places:ps.results.map(p=>({...p,hidden:Boolean(p.hidden),tags:readTags(p.tags_json),tags_json:undefined,hours:JSON.parse(p.hours_json),hours_json:undefined,note:p.note||'',links:ls.results.filter(l=>l.place_id===p.id)}))};
  const tripRecord=await stmt(db,'SELECT * FROM trips WHERE id=?',TRIP).first();
  data.trip={...data.trip,departure_date:tripRecord?.departure_date,start_date:tripRecord?.start_date,end_date:tripRecord?.end_date};
  if(path==='/api/export')data.planning=planningData(db);
  return json(data,200,path==='/api/export'?{'Content-Disposition':'attachment; filename="taiwan-map.json"'}:{});
 }
 const statusMatch=path.match(/^\/api\/statuses\/([a-zA-Z0-9-]+)$/);
 if((path==='/api/statuses'&&request.method==='POST')||(statusMatch&&request.method==='PUT')){
  if(!['owner','admin','editor'].includes(user.role))fail(403,'Нужны права редактирования.');
  const b=await body(request),label=typeof b.label==='string'?b.label.trim():'',symbol=typeof b.symbol==='string'?b.symbol.normalize('NFC'):b.symbol===undefined?'':b.symbol;
  if(!label||label.length>40||typeof b.color!=='string'||!/^#[0-9a-f]{6}$/i.test(b.color))fail(400,'Название: 1–40 символов; цвет: #RRGGBB.');
  if(!validStatusSymbol(symbol))fail(400,'Символ: одна буква, цифра или текстовый знак, либо пустое поле. Emoji, пробелы и невидимые знаки не поддерживаются.');
  if(b.dimmed!==undefined&&typeof b.dimmed!=='boolean')fail(400,'Некорректная настройка полупрозрачности.');
  if(statusMatch){
   if(!Number.isSafeInteger(b.version)||b.version<1)fail(400,'Некорректная версия статуса.');
   const current=await stmt(db,'SELECT id,sort_order,dimmed FROM statuses WHERE id=? AND trip_id=? AND archived=0',statusMatch[1],TRIP).first();if(!current)fail(404,'Статус не найден.');
   const dimmed=b.dimmed===undefined?current.dimmed:Number(b.dimmed);
   const updated=await stmt(db,`UPDATE statuses SET label=?,color=?,symbol=?,dimmed=?,version=version+1 WHERE id=? AND trip_id=? AND archived=0 AND version=? AND NOT EXISTS (SELECT 1 FROM statuses WHERE trip_id=? AND label=? AND archived=0 AND id<>?)`,label,b.color,symbol,dimmed,current.id,TRIP,b.version,TRIP,label,current.id).run();
   if(!updated.meta.changes)fail(409,'Статус уже изменён или такое название занято. Выберите статус в списке заново и повторите изменения.');
   return json({id:current.id,label,color:b.color,symbol,dimmed:Boolean(dimmed),version:b.version+1,sort_order:current.sort_order});
  }
  const id=crypto.randomUUID(),sort_order=Date.now(),dimmed=Number(b.dimmed??false);
  const created=await stmt(db,`INSERT INTO statuses(id,trip_id,label,color,symbol,dimmed,sort_order,created_by) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM statuses WHERE trip_id=? AND archived=0)<100 AND NOT EXISTS (SELECT 1 FROM statuses WHERE trip_id=? AND label=? AND archived=0)`,id,TRIP,label,b.color,symbol,dimmed,sort_order,user.id,TRIP,TRIP,label).run();
  if(!created.meta.changes)fail(409,'Такой статус уже есть или достигнут лимит 100 статусов.');return json({id,label,color:b.color,symbol,dimmed:Boolean(dimmed),version:1,sort_order},201);
 }
 const match=path.match(/^\/api\/places\/([a-zA-Z0-9-]+)\/state$/);
 if(match&&request.method==='PUT'){
  if(!['owner','admin','editor'].includes(user.role))fail(403,'Доступ только для просмотра.');
  const place=await stmt(db,'SELECT * FROM places WHERE id=? AND trip_id=? AND hidden=0',match[1],TRIP).first();if(!place)fail(404,'Место не найдено.');
  // One bounded request can contain both a 2000-character note and schedule.
  const b=await body(request,32768);if(!Number.isSafeInteger(b.version)||b.version<0||typeof b.note!=='string'||b.note.length>2000)fail(400,'Некорректная версия или заметка (до 2000 символов).');
  if(b.status_id!==null&&(typeof b.status_id!=='string'||!await stmt(db,'SELECT id FROM statuses WHERE id=? AND trip_id=? AND archived=0',b.status_id,TRIP).first()))fail(400,'Неизвестный статус.');
  const hasTags=Object.hasOwn(b,'tags');let tags;
  if(hasTags){
   if(!Number.isSafeInteger(b.tags_version)||b.tags_version<1)fail(400,'Некорректная версия ярлыков.');
   if(b.tags_version!==place.tags_version)fail(409,'Ярлыки изменены. Обновите данные и повторите.');
   try{tags=mergeTags(readTags(place.tags_json),b.tags)}catch(error){fail(400,error.message)}
  }
  guardPlanningStatus(db,place.id,b.status_id,stateUser);
  const now=Date.now(),next=b.version+1,eventId=crypto.randomUUID();
  const statements=[
   b.version===0 ? stmt(db,'INSERT OR IGNORE INTO user_place_states(user_id,place_id,status_id,note,version,updated_at) SELECT ?,?,?,?,1,? WHERE EXISTS (SELECT 1 FROM places WHERE id=? AND trip_id=? AND hidden=0)',stateUser,place.id,b.status_id,b.note,now,place.id,TRIP) : stmt(db,'UPDATE user_place_states SET status_id=?,note=?,version=version+1,updated_at=? WHERE user_id=? AND place_id=? AND version=? AND EXISTS (SELECT 1 FROM places WHERE id=? AND trip_id=? AND hidden=0)',b.status_id,b.note,now,stateUser,place.id,b.version,place.id,TRIP),
   stmt(db,`INSERT INTO state_events(id,user_id,place_id,status_id,note,version,created_at) SELECT ?,?,place_id,status_id,note,version,? FROM user_place_states WHERE user_id=? AND place_id=? AND version=? AND changes()=1`,eventId,user.id,now,stateUser,place.id,next)
  ];
  if(hasTags)statements.push(stmt(db,'UPDATE places SET tags_json=?,tags_version=tags_version+1,updated_at=? WHERE id=? AND trip_id=? AND tags_version=? AND changes()=1',JSON.stringify(tags),now,place.id,TRIP,b.tags_version));
  // Validate before COMMIT: a stale version or ignored write rolls back every field.
  await db.batch(statements,{validate(results){if(results.some(r=>r.meta.changes!==1))fail(409,'Место или ярлыки изменили на другом устройстве. Обновите данные и повторите.')}});
  return json({version:next,updated_at:now,...(hasTags?{tags,tags_version:b.tags_version+1}:{})});
 }

 fail(404,'Маршрут не найден.');
 }catch(error){if(error instanceof Problem)return json({error:error.message,...(error.details?{details:error.details}:{})},error.status,error.status===429?{'Retry-After':'900'}:{});console.error('API failure',error?.name);return json({error:'Не удалось выполнить запрос. Попробуйте ещё раз.'},500)}
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
