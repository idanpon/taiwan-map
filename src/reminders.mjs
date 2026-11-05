import {createHash} from 'node:crypto';
import {TRIP,body,fail,json,Problem} from './auth.mjs';
import {all,one,run,transaction} from './sqlite.mjs';
import {validDate} from '../public/planning-model.js';
import {validClock,namedZone,localInstants,tripLocalInstants,localPoint,localConflict,resolveLocalChoice,minute} from '../public/trip-timezones.js';

const open=item=>item.state==='open'||item.state==='in_progress';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function conflict(message,details){
 const error=new Problem(409,message);
 error.details=details;
 throw error;
}
export function readZonePlan(db){
 const revision=one(db,'SELECT timezone_revision FROM trips WHERE id=?',TRIP)?.timezone_revision??1;
 return {revision,changes:all(db,'SELECT at,zone,region FROM trip_timezone_changes WHERE trip_id=? ORDER BY at',TRIP)};
}
export function reminderAnchor(item){
 if(!item||item.ends_at&&!item.starts_at)return null;
 if(item.starts_at)return {mode:'offset',at:Date.parse(item.starts_at)};
 const day=item.date_start||item.date_end;
 return day?{mode:'day',day}:null;
}
function ruleView(row,item,plan){
 if(!row)return null;
 return {
  enabled:Boolean(row.enabled),version:row.version,mode:row.mode,local_time:row.local_time,offset_minutes:row.offset_minutes,
  scheduled:row.fires_at!==null?localPoint(row.fires_at,plan):null,review:row.review,
  sent:row.sent_generation===row.generation,active:open(item),adjusted:row.chosen_at!==null
 };
}
function writeRule(db,row,change,now,{rearm=false}={}){
 const next={...row,...change};
 const reschedule=rearm||next.enabled!==row.enabled||next.fires_at!==row.fires_at;
 run(db,`UPDATE planning_reminders SET enabled=?,mode=?,local_time=?,offset_minutes=?,fires_at=?,chosen_at=?,chosen_revision=?,review=?,
  version=version+1,generation=generation+?,updated_at=? WHERE id=?`,
  next.enabled,next.mode,next.local_time,next.offset_minutes,next.fires_at,next.chosen_at,next.chosen_revision,next.review,Number(reschedule),now,row.id);
 if(reschedule)run(db,"UPDATE push_deliveries SET state='expired' WHERE reminder_id=? AND state IN ('queued','sending')",row.id);
}
const getRule=(db,user,id)=>one(db,'SELECT * FROM planning_reminders WHERE user_id=? AND item_id=?',user,id);
const readItem=(db,id)=>one(db,'SELECT * FROM planning_items WHERE id=? AND trip_id=?',id,TRIP);

function resolveRule(db,item,user,input,now){
 const current=getRule(db,user.id,item.id),plan=readZonePlan(db);
 if(input.version!==(current?.version??null)||input.item_version!==item.version||input.timezone_revision!==plan.revision)
  conflict('Запись или напоминание изменились. Откройте карточку заново.');
 if(typeof input.enabled!=='boolean')fail(400,'Укажите, включено ли напоминание.');
 if(!input.enabled){
  if(current?.enabled)writeRule(db,current,{enabled:0,review:null},now);
  return ruleView(getRule(db,user.id,item.id),item,plan);
 }
 const anchor=reminderAnchor(item);
 if(!anchor||!open(item))fail(400,'Для напоминания нужна дата открытой записи.');
 const next={enabled:1,mode:anchor.mode,local_time:null,offset_minutes:null,fires_at:null,chosen_at:null,chosen_revision:null,review:null};
 if(anchor.mode==='offset'){
  if(!Number.isSafeInteger(input.offset_minutes)||input.offset_minutes<0||input.offset_minutes>43200)fail(400,'Укажите интервал от 0 минут до 30 дней.');
  next.offset_minutes=input.offset_minutes;
  next.fires_at=anchor.at-input.offset_minutes*minute;
 }else{
  if(!validClock(input.local_time))fail(400,'Укажите местное время в формате ЧЧ:ММ.');
  next.local_time=input.local_time;
  const check=localConflict(anchor.day,input.local_time,plan,current?.fires_at);
  if(check){
   const fingerprint=digest([item.id,item.version,plan.revision,current?.version,input.local_time]);
   if(!input.choice||input.fingerprint!==fingerprint)
    conflict('Уточните местное время напоминания.',{code:'reminder_time_check',check,fingerprint,title:item.title});
   const picked=resolveLocalChoice(check,input.choice,plan);
   if(!picked)fail(400,'Выберите существующее время и его пояс.');
   if(picked.off){
    if(current)writeRule(db,current,{enabled:0,review:null},now);
    return ruleView(getRule(db,user.id,item.id),item,plan);
   }
   next.fires_at=next.chosen_at=picked.at;
   next.chosen_revision=plan.revision;
  }else next.fires_at=tripLocalInstants(anchor.day,input.local_time,plan)[0];
 }
 if(next.fires_at<=now)fail(400,'Выберите время отправки в будущем.');
 if(current)writeRule(db,current,next,now,{rearm:true});
 else run(db,`INSERT INTO planning_reminders(id,user_id,item_id,enabled,mode,local_time,offset_minutes,fires_at,chosen_at,chosen_revision,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?)`,crypto.randomUUID(),user.id,item.id,1,next.mode,next.local_time,next.offset_minutes,next.fires_at,next.chosen_at,next.chosen_revision,now);
 return ruleView(getRule(db,user.id,item.id),item,plan);
}

// An edit can invalidate pending reminders. Completed deliveries are never re-armed
// by shared changes; a user can still explicitly choose a new reminder.
export function refreshItemReminders(db,old,item,now=Date.now()){
 const before=reminderAnchor(old),anchor=reminderAnchor(item);
 if(JSON.stringify(before)===JSON.stringify(anchor)&&open(old)===open(item))return;
 const rows=all(db,'SELECT * FROM planning_reminders WHERE item_id=? AND enabled=1 AND sent_generation IS NOT generation',item.id);
 if(!rows.length)return;
 const plan=readZonePlan(db);
 for(const row of rows){
  if(!open(item)){
   run(db,"UPDATE push_deliveries SET state='expired' WHERE reminder_id=? AND state IN ('queued','sending')",row.id);
   continue;
  }
  if(JSON.stringify(before)===JSON.stringify(anchor))continue;
  const next={fires_at:null,review:'date_changed',chosen_at:null,chosen_revision:null};
  if(anchor?.mode===row.mode){
   if(row.mode==='offset')next.fires_at=anchor.at-row.offset_minutes*minute;
   else{
    const matches=tripLocalInstants(anchor.day,row.local_time,plan);
    if(matches.length===1)next.fires_at=matches[0];
    else next.review=matches.length?'repeat':'gap';
   }
  }
  if(next.fires_at!==null){
   if(next.fires_at>now)next.review=null;
   else next.fires_at=null;
  }
  writeRule(db,row,next,now);
 }
}

function proposedPlan(db,b){
 const old=readZonePlan(db);
 const trip=one(db,'SELECT planning_version version,departure_date,start_date,end_date FROM trips WHERE id=?',TRIP);
 if(!trip||b.version!==trip.version||b.timezone_revision!==old.revision)conflict('Даты или пояса изменены другим участником. Откройте настройки заново.');
 const dates={departure_date:b.departure_date,start_date:b.start_date,end_date:b.end_date};
 if(!Object.values(dates).every(validDate)||dates.departure_date>dates.start_date||dates.start_date>dates.end_date)fail(400,'Проверьте порядок дат поездки.');
 if(!Array.isArray(b.changes)||b.changes.length>30)fail(400,'Можно задать до 30 прибытий.');
 const changes=b.changes.map(change=>{
  if(!change||typeof change!=='object'||!namedZone(change.zone)||typeof change.region!=='string'||change.region.length>60||!validDate(change.day)||!validClock(change.time))fail(400,'Проверьте дату, время и часовой пояс прибытия.');
  const instants=localInstants(change.day,change.time,change.zone);
  if(!instants.length)fail(400,'Такого местного времени прибытия нет. Укажите другое время.');
  const at=instants.length===1?instants[0]:instants.find(value=>value===change.at);
  if(at===undefined)fail(400,'Время прибытия встречается дважды. Выберите смещение UTC.');
  return {at,zone:change.zone,region:change.region.trim()};
 }).sort((a,b)=>a.at-b.at);
 if(changes.some((change,i)=>change.at===changes[i-1]?.at))fail(400,'Два прибытия не могут быть назначены на один момент.');
 const changed=JSON.stringify(old.changes)!==JSON.stringify(changes);
 return {old,trip,dates,plan:{revision:old.revision+Number(changed),changes},changed};
}
function zonePreview(db,user,b,now){
 const proposal=proposedPlan(db,b),{old,plan,changed,dates,trip}=proposal;
 const rows=changed?all(db,`SELECT r.*,i.title,i.date_start,i.date_end,i.version item_version FROM planning_reminders r
  JOIN planning_items i ON i.id=r.item_id JOIN users u ON u.id=r.user_id
  JOIN memberships m ON m.user_id=r.user_id AND m.trip_id=i.trip_id
  WHERE i.trip_id=? AND u.disabled=0 AND i.state IN ('open','in_progress') AND r.enabled=1 AND r.mode='day'
  AND r.review IS NULL AND r.fires_at>? AND r.sent_generation IS NOT r.generation ORDER BY r.id`,TRIP,now):[];
 const effects=[],mine=[],others={shifted:0,frozen:0};
 for(const row of rows){
  const day=row.date_start||row.date_end;
  if(!day)continue;
  const before=localPoint(row.fires_at,old);
  const instants=tripLocalInstants(day,row.local_time,plan);
  const check=instants.length!==1?localConflict(day,row.local_time,plan,row.fires_at):null;
  const next=instants.length===1?localPoint(instants[0],plan):null;
  if(check&&row.chosen_at!==null){
   const previous=localConflict(day,row.local_time,old,row.fires_at),presets=c=>[c?.kind,c?.jump?.at,c?.before?.at,c?.after?.at];
   const adjusted=localPoint(row.chosen_at,plan);
   if(JSON.stringify(presets(previous))===JSON.stringify(presets(check))&&adjusted.zone===before.zone&&adjusted.time===before.time&&adjusted.day===before.day)continue;
  }
  if(next&&next.at===row.fires_at&&next.badge===before.badge&&next.time===before.time&&!row.chosen_at)continue;
  effects.push({row,check,next});
  if(row.user_id===user.id)mine.push({id:row.id,title:row.title,before,next,check,willSkip:Boolean(next&&next.at<=now)});
  else if(check)others.frozen++;
  else others.shifted++;
 }
 const fingerprint=digest([trip.version,old.revision,dates,plan.changes,effects.map(({row,check,next})=>[row.id,row.version,row.item_version,check?.kind,next?.at,next?.at<=now])]);
 return {...proposal,effects,view:{mine,others,fingerprint}};
}
function applyZones(db,user,b,now){
 const {view,dates,plan,changed,effects}=zonePreview(db,user,b,now);
 if(view.fingerprint!==b.fingerprint)conflict('Данные изменились. Проверьте обновлённый предпросмотр.',{code:'timezone_preview_stale',preview:view});
 for(const {row,check,next} of effects){
  const change={chosen_at:null,chosen_revision:null,review:null};
  if(check&&row.user_id===user.id){
   const choice=b.choices&&Object.hasOwn(b.choices,row.id)?b.choices[row.id]:null;
   const picked=resolveLocalChoice(check,choice,plan);
   if(!picked)fail(400,'Уточните время каждого своего напоминания.');
   if(picked.off){change.enabled=0}
   else{
    if(picked.at<=now)fail(400,'Выберите время отправки в будущем.');
    change.fires_at=change.chosen_at=picked.at;change.chosen_revision=plan.revision;
   }
  }else if(check){
   change.review=check.kind; // Retain the same absolute send time and generation.
  }else if(next.at<=now){
   change.fires_at=null;change.review='date_changed';
  }else change.fires_at=next.at;
  writeRule(db,row,change,now);
 }
 if(changed){
  run(db,'DELETE FROM trip_timezone_changes WHERE trip_id=?',TRIP);
  for(const row of plan.changes)run(db,'INSERT INTO trip_timezone_changes(trip_id,at,zone,region) VALUES(?,?,?,?)',TRIP,row.at,row.zone,row.region);
 }
 run(db,'UPDATE trips SET departure_date=?,start_date=?,end_date=?,planning_version=planning_version+1,timezone_revision=? WHERE id=?',
  dates.departure_date,dates.start_date,dates.end_date,plan.revision,TRIP);
 run(db,'INSERT INTO planning_events VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),TRIP,null,user.id,'trip',JSON.stringify({...dates,timezone_changes:plan.changes}),now);
 return {ok:true,version:b.version+1,timezone_plan:plan};
}
export async function handleReminders(request,db,user){
 const {pathname:path}=new URL(request.url),method=request.method;
 const match=path.match(/^\/api\/planning\/items\/([a-zA-Z0-9-]+)\/reminder$/);
 if(match){
  if(method==='GET'){
   const item=readItem(db,match[1]);if(!item)fail(404,'Запись календаря не найдена.');
   return json({reminder:ruleView(getRule(db,user.id,item.id),item,readZonePlan(db))});
  }
  if(method!=='PUT')fail(405,'Неизвестное действие.');
  const b=await body(request);
  return transaction(db,()=>{
   const item=readItem(db,match[1]);if(!item)fail(404,'Запись календаря не найдена.');
   return json({reminder:resolveRule(db,item,user,b,Date.now())});
  });
 }
 if(path!=='/api/planning/timezones'&&path!=='/api/planning/timezones/preview')return null;
 if(!['owner','admin','editor'].includes(user.role))fail(403,'Нужны права редактирования.');
 if(path.endsWith('/preview')&&method==='POST')return json(zonePreview(db,user,await body(request,65536),Date.now()).view);
 if(path.endsWith('/timezones')&&method==='PUT'){
  const b=await body(request,65536);
  return transaction(db,()=>json(applyZones(db,user,b,Date.now())));
 }
 fail(405,'Неизвестное действие.');
}
