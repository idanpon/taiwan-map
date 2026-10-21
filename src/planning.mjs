import {createHash} from 'node:crypto';
import {TRIP,SHARED_USER,body,fail,json,Problem} from './auth.mjs';
import {validDate,validZone,dayInZone,kindLabels,priorityLabels} from '../public/planning-model.js';
const editable=u=>['owner','admin','editor'].includes(u.role);
const conflict=(message,details={})=>{const error=new Problem(409,message);error.details=details;throw error};
const all=(db,sql,...args)=>db.sqlite.prepare(sql).all(...args);
const one=(db,sql,...args)=>db.sqlite.prepare(sql).get(...args);
const run=(db,sql,...args)=>db.sqlite.prepare(sql).run(...args);
const transaction=(db,fn)=>{db.sqlite.exec('BEGIN IMMEDIATE');try{const value=fn();db.sqlite.exec('COMMIT');return value}catch(error){db.sqlite.exec('ROLLBACK');throw error}};
const event=(db,user,item,action,payload)=>run(db,'INSERT INTO planning_events VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),TRIP,item,user.id,action,JSON.stringify(payload),Date.now());
function itemById(db,id){const item=one(db,'SELECT * FROM planning_items WHERE id=? AND trip_id=?',id,TRIP);if(!item)fail(404,'Запись календаря не найдена.');return item}
function readItem(db,row){return {...row,fixed_external:Boolean(row.fixed_external),source_urls:JSON.parse(row.source_urls),options:all(db,'SELECT * FROM planning_options WHERE item_id=? ORDER BY sort_order,id',row.id),places:all(db,'SELECT l.*,p.name current_name,p.hidden FROM planning_item_places l LEFT JOIN places p ON p.id=l.place_id WHERE l.item_id=? ORDER BY l.id',row.id).map(l=>({...l,affects_visit:Boolean(l.affects_visit),place_name:l.current_name||l.place_name,deleted:!l.place_id})),dependencies:all(db,'SELECT depends_on_id FROM planning_dependencies WHERE item_id=?',row.id).map(r=>r.depends_on_id)}}
export function planningData(db){return {trip:one(db,'SELECT id,name,timezone,departure_date,start_date,end_date,planning_version version FROM trips WHERE id=?',TRIP),items:all(db,'SELECT * FROM planning_items WHERE trip_id=? ORDER BY date_start,sort_order,title',TRIP).map(row=>readItem(db,row)),users:all(db,"SELECT u.id,u.display_name name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.trip_id=? AND u.disabled=0 AND m.role IN ('admin','editor','viewer') ORDER BY u.display_name",TRIP),places:all(db,'SELECT id,name,city,hidden FROM places WHERE trip_id=? ORDER BY city,name',TRIP)}}
export function unresolvedForPlace(db,placeId){return all(db,`SELECT DISTINCT i.id,i.title FROM planning_items i JOIN planning_item_places l ON l.item_id=i.id WHERE i.trip_id=? AND l.place_id=? AND l.affects_visit=1 AND i.kind='decision' AND i.state IN ('open','in_progress') ORDER BY i.title`,TRIP,placeId)}
export function guardPlanningStatus(db,placeId,statusId,stateUser){if(!one(db,"SELECT 1 FROM sqlite_master WHERE type='table' AND name='planning_items'"))return;const previous=one(db,'SELECT status_id FROM user_place_states WHERE user_id=? AND place_id=?',stateUser,placeId)?.status_id??null;if(previous===statusId)return;const decisions=unresolvedForPlace(db,placeId);if(decisions.length)conflict('Статус связан с незакрытым решением. Перейдите в календарь, чтобы зафиксировать выбор.',{code:'planning_decision_required',decisions})}
function text(value,name,max,required=false){if(typeof value!=='string'||value.length>max||required&&!value.trim())fail(400,`Проверьте поле «${name}» (до ${max} символов).`);return required?value.trim():value}
function normalize(db,b,current={}){
 const value={...current,...b};delete value.ack_dependencies;
 const kind=value.kind;if(!Object.hasOwn(kindLabels,kind))fail(400,'Неизвестный тип записи.');
 const out={kind,title:text(value.title,'Название',160,true),description:text(value.description??'','Описание',10000),note:text(value.note??'','Заметка',5000),state:value.state??'open',priority:value.priority??'normal',assignee_id:value.assignee_id||null,date_start:value.date_start||null,date_end:value.date_end||null,starts_at:value.starts_at||null,ends_at:value.ends_at||null,event_timezone:value.event_timezone||'Asia/Taipei',sort_order:value.sort_order??0,fixed_external:value.fixed_external??false,source_urls:value.source_urls??[]};
 if(!['open','in_progress','done','cancelled'].includes(out.state)||!Object.hasOwn(priorityLabels,out.priority)||!Number.isSafeInteger(out.sort_order)||Math.abs(out.sort_order)>1000000||typeof out.fixed_external!=='boolean')fail(400,'Проверьте состояние, приоритет и порядок.');
 if(!validZone(out.event_timezone))fail(400,'Некорректный часовой пояс.');
 for(const key of ['date_start','date_end'])if(out[key]&&!validDate(out[key]))fail(400,'Некорректная календарная дата.');
 for(const key of ['starts_at','ends_at'])if(out[key]){if(typeof out[key]!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{3})?)?Z$/.test(out[key])||!validDate(out[key].slice(0,10))||!Number.isFinite(Date.parse(out[key])))fail(400,'Точное время передаётся в UTC.');out[key]=new Date(out[key]).toISOString()}
 if(out.starts_at)out.date_start=dayInZone(out.starts_at,out.event_timezone);
 if(out.ends_at)out.date_end=dayInZone(out.ends_at,out.event_timezone);
 if(out.date_start&&out.date_end&&out.date_start>out.date_end||out.starts_at&&out.ends_at&&out.starts_at>out.ends_at)fail(400,'Окончание должно быть не раньше начала.');
 if(out.kind==='visit'&&!out.date_start&&!out.date_end)fail(400,'Для пункта маршрута укажите дату.');
 if(out.assignee_id&&typeof out.assignee_id!=='string')fail(400,'Некорректный ответственный.');
 if(out.assignee_id&&out.assignee_id!==current.assignee_id&&!one(db,'SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.trip_id=? AND u.disabled=0',out.assignee_id,TRIP))fail(400,'Ответственный не найден.');
 if(!Array.isArray(out.source_urls)||out.source_urls.length>20||out.source_urls.some(url=>{try{const u=new URL(url);return !['https:','http:'].includes(u.protocol)||Boolean(u.username||u.password)||url.length>2000}catch{return true}}))fail(400,'Укажите корректные HTTP/HTTPS-источники.');
 out.options=value.options??[];out.places=value.places??[];out.dependencies=value.dependencies??[];
 if(!Array.isArray(out.options)||out.options.length>20||!Array.isArray(out.places)||out.places.length>200||!Array.isArray(out.dependencies)||out.dependencies.length>100)fail(400,'Слишком много связей или вариантов.');
 if(out.kind!=='decision'&&out.options.length)fail(400,'Варианты доступны только решениям.');
 const ids=new Set();out.options=out.options.map((o,i)=>{if(!o||typeof o!=='object'||Array.isArray(o))fail(400,'Некорректный вариант.');const id=o.id||crypto.randomUUID();if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id)||ids.has(id)||one(db,'SELECT 1 FROM planning_options WHERE id=? AND item_id<>?',id,current.id||''))fail(400,'Некорректный ID варианта.');ids.add(id);return {id,label:text(o.label,'Вариант',160,true),description:text(o.description??'','Описание варианта',5000),sort_order:i}});
 out.places=out.places.map(l=>{if(!l||typeof l!=='object'||Array.isArray(l))fail(400,'Некорректная связь.');if(l.place_id&&typeof l.place_id!=='string'||l.affects_visit!==undefined&&typeof l.affects_visit!=='boolean')fail(400,'Некорректная связь с местом.');const p=l.place_id?one(db,'SELECT id,name FROM places WHERE id=? AND trip_id=?',l.place_id,TRIP):null;if(l.place_id&&!p)fail(400,'Связанное место удалено. Обновите данные.');if(l.option_id&&!ids.has(l.option_id))fail(400,'Связь с неизвестным вариантом.');if(l.affects_visit&&out.kind!=='decision')fail(400,'Условие посещения относится к решению.');if(l.affects_visit&&!l.option_id)fail(400,'Для условия посещения укажите вариант решения.');if(!['keep','hide'].includes(l.unselected_action||'keep'))fail(400,'Альтернативы можно только скрыть или оставить.');return {place_id:p?.id??null,place_name:p?.name||text(l.place_name||'Место удалено','Подпись места',200,true),option_id:l.option_id||null,affects_visit:Boolean(l.affects_visit),unselected_action:l.unselected_action||'keep'}});
 out.dependencies=[...new Set(out.dependencies)];for(const id of out.dependencies)if(id===current.id||typeof id!=='string'||!one(db,'SELECT 1 FROM planning_items WHERE id=? AND trip_id=?',id,TRIP))fail(400,'Некорректная зависимость.');
 if(current.id)for(const id of out.dependencies){const cycle=one(db,`WITH RECURSIVE chain(id) AS (SELECT ? UNION SELECT d.depends_on_id FROM planning_dependencies d JOIN chain c ON c.id=d.item_id) SELECT 1 FROM chain WHERE id=? LIMIT 1`,id,current.id);if(cycle)fail(400,'Зависимости не должны образовывать цикл.')}
 return out;
}
function writeRelations(db,id,value){run(db,'DELETE FROM planning_item_places WHERE item_id=?',id);run(db,'DELETE FROM planning_options WHERE item_id=?',id);run(db,'DELETE FROM planning_dependencies WHERE item_id=?',id);for(const o of value.options)run(db,'INSERT INTO planning_options VALUES(?,?,?,?,?)',o.id,id,o.label,o.description,o.sort_order);for(const l of value.places)run(db,'INSERT INTO planning_item_places VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),id,l.option_id,l.place_id,l.place_name,Number(l.affects_visit),l.unselected_action);for(const dep of value.dependencies)run(db,'INSERT INTO planning_dependencies VALUES(?,?)',id,dep)}
const fields=['kind','title','description','note','state','priority','assignee_id','date_start','date_end','starts_at','ends_at','event_timezone','sort_order','fixed_external','source_urls'];
const values=v=>fields.map(key=>key==='source_urls'?JSON.stringify(v[key]):key==='fixed_external'?Number(v[key]):v[key]);
function currentPlace(db,id){return one(db,`SELECT p.id,p.name,p.hidden,p.visibility_version,COALESCE(s.version,0) state_version,s.status_id,s.note FROM places p LEFT JOIN user_place_states s ON s.place_id=p.id AND s.user_id=? WHERE p.id=? AND p.trip_id=?`,SHARED_USER,id,TRIP)}
function setPlaceStatus(db,user,placeId,statusId){
 const p=currentPlace(db,placeId);if(!p||p.status_id===statusId)return;
 run(db,`INSERT INTO user_place_states(user_id,place_id,status_id,note,version,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,place_id) DO UPDATE SET status_id=excluded.status_id,version=excluded.version,updated_at=excluded.updated_at`,SHARED_USER,p.id,statusId,p.note||'',p.state_version+1,Date.now());
 run(db,'INSERT INTO state_events VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),user.id,p.id,statusId,p.note||'',p.state_version+1,Date.now());
}
function computePreview(db,id,input){
 const item=itemById(db,id);if(item.kind!=='decision')fail(400,'Это не решение.');
 const mode=input.mode||'resolve';if(!['resolve','reopen'].includes(mode))fail(400,'Неизвестное действие.');
 if(mode==='resolve'&&!['open','in_progress'].includes(item.state)||mode==='reopen'&&item.state!=='done')conflict('Состояние решения изменилось. Обновите запись.');
 if(mode==='resolve'&&!one(db,'SELECT 1 FROM planning_options WHERE id=? AND item_id=?',input.option_id,id))fail(400,'Выберите вариант.');
 const overrides=input.alternatives??{};if(!overrides||Array.isArray(overrides)||typeof overrides!=='object'||Object.values(overrides).some(v=>!['keep','hide'].includes(v)))fail(400,'Альтернативы можно только скрыть или оставить.');
 const links=all(db,'SELECT * FROM planning_item_places WHERE item_id=?',id),effects=[],warnings=[],related=[];
 const latest=mode==='reopen'?one(db,"SELECT payload FROM planning_events WHERE item_id=? AND action='resolve' ORDER BY created_at DESC,rowid DESC LIMIT 1",id):null;
 const previousEffects=latest?JSON.parse(latest.payload).effects:[];
 for(const placeId of [...new Set(links.map(l=>l.place_id).filter(Boolean))]){
  const p=currentPlace(db,placeId);if(!p)continue;
  const references=all(db,`SELECT i.id,i.title,i.kind,i.state,i.selected_option_id,l.option_id,l.affects_visit FROM planning_item_places l JOIN planning_items i ON i.id=l.item_id WHERE l.place_id=? AND i.trip_id=?`,placeId,TRIP);
  related.push({place_id:placeId,name:p.name,items:[...new Map(references.map(r=>[r.id,{id:r.id,title:r.title,kind:r.kind,state:r.state}])).values()]});
  let targetStatus=p.status_id,targetHidden=p.hidden;
  if(mode==='reopen'){
   const effect=previousEffects.find(e=>e.id===placeId);
   if(effect){
    if(effect.after.status_id!==effect.before.status_id){if(p.state_version===effect.after.state_version&&p.status_id===effect.after.status_id)targetStatus=effect.before.status_id;else warnings.push(p.name+': статус менялся позднее; сохранён текущий.')}
    if(effect.after.hidden!==effect.before.hidden){if(p.visibility_version===effect.after.visibility_version&&p.hidden===effect.after.hidden)targetHidden=effect.before.hidden;else warnings.push(p.name+': видимость менялась позднее; сохранена текущая.')}
   }
   if(links.some(l=>l.place_id===placeId&&l.affects_visit)&&['want',null].includes(targetStatus)){
    const auto=one(db,`SELECT CAST(json_extract(effect.value,'$.after.state_version') AS INTEGER) version FROM planning_events ev,json_each(ev.payload,'$.effects') effect WHERE ev.trip_id=? AND json_extract(effect.value,'$.id')=? AND json_extract(effect.value,'$.after.status_id')='want' AND json_extract(effect.value,'$.before.status_id') IS NOT 'want' ORDER BY version DESC LIMIT 1`,TRIP,placeId);
    const subsequent=auto&&one(db,"SELECT 1 FROM state_events WHERE place_id=? AND version>? AND status_id IS NOT 'want' LIMIT 1",placeId,auto.version);
    if(targetStatus===null||auto&&!subsequent){if(one(db,"SELECT 1 FROM statuses WHERE id='maybe' AND trip_id=? AND archived=0",TRIP))targetStatus='maybe';else warnings.push(p.name+': статус вопроса недоступен; текущий статус сохранён.')}
    else warnings.push(p.name+': появился незакрытый выбор; позднейший ручной статус сохранён. Проверьте его при обсуждении решения.');
   }
  }else{
   const affecting=references.filter(r=>r.affects_visit&&r.kind==='decision'&&r.state!=='cancelled');
   const pending=[...new Map(affecting.filter(r=>r.id!==id&&r.state!=='done').map(r=>[r.id,r])).values()];
   const opinions=[...new Set(affecting.filter(r=>r.id===id||r.state==='done').map(r=>r.id))].map(decisionId=>{const rows=affecting.filter(r=>r.id===decisionId),selected=decisionId===id?input.option_id:rows[0].selected_option_id;return rows.some(r=>r.option_id===selected)});
   const own=links.filter(l=>l.place_id===placeId&&l.affects_visit),chosen=own.some(l=>l.option_id===input.option_id);
   if(pending.length)warnings.push(p.name+': остаётся под вопросом — '+pending.map(r=>r.title).join('; '));
   else if(opinions.includes(true)&&opinions.includes(false))warnings.push(p.name+': результаты решений противоречат друг другу; статус и видимость сохранены.');
   else if(own.length&&chosen){
    if(!p.status_id||['maybe','want'].includes(p.status_id)){if(one(db,"SELECT 1 FROM statuses WHERE id='want' AND trip_id=? AND archived=0",TRIP))targetStatus='want';else warnings.push(p.name+': статус «Хотим посетить» недоступен; текущий статус сохранён.')}
    else warnings.push(p.name+': сохранён текущий пользовательский статус.');
    if(p.hidden)warnings.push(p.name+': место уже скрыто; вернуть его можно в скрытых местах.');
   }else if(own.length&&!chosen&&!(opinions.includes(true)))targetHidden=(overrides[placeId]||own[0].unselected_action)==='hide'?1:p.hidden;
  }
  effects.push({id:placeId,name:p.name,before:{status_id:p.status_id,hidden:p.hidden,state_version:p.state_version,visibility_version:p.visibility_version},after:{status_id:targetStatus,hidden:targetHidden,state_version:p.state_version+Number(targetStatus!==p.status_id),visibility_version:p.visibility_version+Number(targetHidden!==p.hidden)}});
 }
 for(const l of links.filter(l=>!l.place_id))warnings.push(l.place_name+': место удалено и не будет восстановлено.');
 const snapshot={item,items:all(db,'SELECT id,version,state,selected_option_id FROM planning_items WHERE trip_id=? ORDER BY id',TRIP),links:all(db,'SELECT * FROM planning_item_places ORDER BY id'),statuses:all(db,'SELECT id,version,archived FROM statuses WHERE trip_id=? ORDER BY id',TRIP),effects};
 const fingerprint=createHash('sha256').update(JSON.stringify({snapshot,mode,option_id:input.option_id||null,alternatives:overrides})).digest('hex');
 const next_steps=all(db,'SELECT i.id,i.title,i.state FROM planning_items i JOIN planning_dependencies d ON d.item_id=i.id WHERE d.depends_on_id=? AND i.trip_id=? ORDER BY i.title',id,TRIP);
 return {mode,item_id:id,next_steps,version:item.version,option_id:input.option_id||null,alternatives:overrides,effects,warnings,related,fingerprint};
}
export async function handlePlanning(request,db,user,{creationId=null}={}){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(!path.startsWith('/api/planning'))return null;
 if(path==='/api/planning'&&method==='GET')return json(planningData(db));
 const history=path.match(/^\/api\/planning\/items\/([a-zA-Z0-9-]+)\/events$/);
 if(history&&method==='GET'){itemById(db,history[1]);return json({events:all(db,'SELECT e.id,e.action,e.payload,e.created_at,u.display_name actor FROM planning_events e JOIN users u ON u.id=e.actor_id WHERE e.item_id=? ORDER BY e.created_at DESC,e.rowid DESC LIMIT 100',history[1]).map(e=>({...e,payload:JSON.parse(e.payload)}))})}
 if(!editable(user))fail(403,'Доступ только для просмотра.');
 const b=await body(request,65536);
 return transaction(db,()=>{
  if(path==='/api/planning/trip'&&method==='PUT'){
   if(!Number.isSafeInteger(b.version))fail(400,'Укажите версию поездки.');
   for(const k of ['departure_date','start_date','end_date'])if(!validDate(b[k]))fail(400,'Проверьте даты поездки.');
   if(b.departure_date>b.start_date||b.start_date>b.end_date)fail(400,'Проверьте порядок дат поездки.');
   const r=run(db,'UPDATE trips SET departure_date=?,start_date=?,end_date=?,planning_version=planning_version+1 WHERE id=? AND planning_version=?',b.departure_date,b.start_date,b.end_date,TRIP,b.version);if(!r.changes)conflict('Даты поездки изменены другим участником.');event(db,user,null,'trip',b);return json({ok:true,version:b.version+1});
  }
  const action=path.match(/^\/api\/planning\/items\/([a-zA-Z0-9-]+)\/(preview|resolve)$/);
  if(action&&method==='POST'){
   const preview=computePreview(db,action[1],b);if(action[2]==='preview')return json(preview);
   if(b.version!==preview.version||b.fingerprint!==preview.fingerprint)conflict('Данные изменились. Обновите предварительный просмотр.');
   for(const e of preview.effects){
    if(e.before.status_id!==e.after.status_id){if(e.after.status_id&&!one(db,'SELECT 1 FROM statuses WHERE id=? AND trip_id=? AND archived=0',e.after.status_id,TRIP))conflict('Статус больше недоступен. Обновите предварительный просмотр.');
     run(db,`INSERT INTO user_place_states(user_id,place_id,status_id,note,version,updated_at) VALUES(?,?,?,COALESCE((SELECT note FROM user_place_states WHERE user_id=? AND place_id=?),''),?,?) ON CONFLICT(user_id,place_id) DO UPDATE SET status_id=excluded.status_id,version=excluded.version,updated_at=excluded.updated_at`,SHARED_USER,e.id,e.after.status_id,SHARED_USER,e.id,e.after.state_version,Date.now());
     run(db,'INSERT INTO state_events VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),user.id,e.id,e.after.status_id,one(db,'SELECT note FROM user_place_states WHERE user_id=? AND place_id=?',SHARED_USER,e.id).note,e.after.state_version,Date.now());
    }
    if(e.before.hidden!==e.after.hidden)run(db,'UPDATE places SET hidden=?,visibility_version=?,updated_at=? WHERE id=?',e.after.hidden,e.after.visibility_version,Date.now(),e.id);
   }
   const reopen=preview.mode==='reopen';run(db,'UPDATE planning_items SET state=?,selected_option_id=?,version=version+1,updated_by=?,updated_at=?,completed_at=? WHERE id=?',reopen?'open':'done',reopen?null:preview.option_id,user.id,Date.now(),reopen?null:Date.now(),preview.item_id);event(db,user,preview.item_id,reopen?'reopen':'resolve',preview);return json({item:readItem(db,itemById(db,preview.item_id)),preview});
  }
  const match=path.match(/^\/api\/planning\/items\/([a-zA-Z0-9-]+)$/),creating=path==='/api/planning/items'&&method==='POST';
  if(!creating&&!(match&&['PUT','DELETE'].includes(method)))fail(404,'Маршрут планировщика не найден.');
  const old=creating?null:readItem(db,itemById(db,match[1]));
  if(old&&b.version!==old.version)conflict('Запись изменена другим участником. Обновите данные; черновик можно скопировать.');
  if(method==='DELETE'){if(old.kind==='decision'&&old.state==='done')conflict('Сначала пересмотрите решение, чтобы проверить последствия.');event(db,user,old.id,'delete',{before:old});run(db,'DELETE FROM planning_items WHERE id=?',old.id);return json({ok:true})}
  if(creating&&one(db,'SELECT COUNT(*) n FROM planning_items WHERE trip_id=?',TRIP).n>=1000)fail(400,'Достигнут лимит 1000 записей.');
  const value=normalize(db,b,old||{}),id=old?.id||creationId||crypto.randomUUID(),now=Date.now();
  if(old?.kind==='decision'&&old.state==='done'){
   const previous=normalize(db,{},old);
   if(value.kind!==old.kind||value.state!==old.state||['options','places','dependencies'].some(key=>JSON.stringify(value[key])!==JSON.stringify(previous[key])))conflict('Для изменения вариантов сначала откройте решение повторно.');
  }
  if(value.kind==='decision'&&value.state==='done'&&old?.state!=='done')fail(400,'Решение завершается выбором варианта с предварительным просмотром.');
  const blockers=value.dependencies.map(dep=>itemById(db,dep)).filter(i=>!['done','cancelled'].includes(i.state));
  if(value.state==='done'&&old?.state!=='done'&&blockers.length&&!b.ack_dependencies)conflict('Есть незавершённые зависимости. Всё равно отметить выполнение?',{code:'dependencies_open',dependencies:blockers.map(i=>({id:i.id,title:i.title}))});
  if(old)run(db,`UPDATE planning_items SET ${fields.map(k=>k+'=?').join(',')},version=version+1,updated_by=?,updated_at=?,completed_at=? WHERE id=?`,...values(value),user.id,now,value.state==='done'?(old.completed_at||now):null,id);
  else run(db,`INSERT INTO planning_items(id,trip_id,${fields.join(',')},created_by,updated_by,created_at,updated_at,completed_at) VALUES(${Array(2+fields.length+5).fill('?').join(',')})`,id,TRIP,...values(value),user.id,user.id,now,now,value.state==='done'?now:null);
  writeRelations(db,id,value);
  if(value.kind==='decision'&&['open','in_progress'].includes(value.state)){
   const existing=new Set(old&&old.kind==='decision'&&['open','in_progress'].includes(old.state)?old.places.filter(l=>l.affects_visit).map(l=>l.place_id):[]);
   for(const placeId of new Set(value.places.filter(l=>l.affects_visit&&l.place_id&&!existing.has(l.place_id)).map(l=>l.place_id))){
    const p=currentPlace(db,placeId);
    if(p&&(!p.status_id||p.status_id==='want')){if(!one(db,"SELECT 1 FROM statuses WHERE id='maybe' AND trip_id=? AND archived=0",TRIP))conflict('Статус вопроса недоступен. Восстановите его перед добавлением условия посещения.');setPlaceStatus(db,user,placeId,'maybe')}
   }
  }
  event(db,user,id,old?'update':'create',{before:old,after:readItem(db,itemById(db,id))});return json({item:readItem(db,itemById(db,id))},creating?201:200);
 });
}
