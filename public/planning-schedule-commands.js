import { invalid, closed, validId, reference, checkVersion, textField, zoneValid } from './planning-domain-common.js';
import { validDate, dayInZone } from './planning-model.js';
import { instant } from './planning-preparation.js';
import { live, activePlacement } from './planning-readiness.js';
import { transition, transitionContext, boundServices, canonical } from './planning-transitions.js';
import { deriveSchedule, placementConstraints, scheduleIssue } from './planning-schedule.js';
import { groupShift } from './planning-group-shift.js';
import { compatibleScopes, scopePath } from './planning-scopes.js';

export const scheduleFields={
  set_time_constraint:['id','placement_id','expected_version','data'],remove_time_constraint:['id','expected_version','reason'],
  set_time_link:['id','from_placement_id','to_placement_id','expected_version','data'],remove_time_link:['id','expected_version'],
  set_transition_override:['id','from_placement_id','to_placement_id','expected_version','data'],remove_transition_override:['id','expected_version'],
  approve_placement:['id','expected_version'],make_tentative:['id','expected_version','reason'],
  apply_group_shift:['id','expected_version','data'],request_reschedule:['id','expected_version','data','reason','task_id'],
  close_reschedule_request:['id','expected_version','reason'],
};
const slotFields=['starts_at','ends_at','date_start','date_end','start_timezone','end_timezone','precision','part_of_day','intended_duration_minutes'];
export function validateScheduleCommand(c){
  const creating=c.type.startsWith('set_')&&c.expected_version===0;
  if(!Number.isSafeInteger(c.expected_version)||c.expected_version<(creating?0:1))invalid('EXPECTED_VERSION_REQUIRED','Укажите ожидаемую версию.',400);
  if(creating&&c.id!==undefined&&!validId(c.id))invalid('INVALID_ID','Некорректный ID.');
  if(c.type==='set_time_constraint')closed(c.data,['kind','values','reason','source_url']);
  if(c.type==='set_time_link')closed(c.data,['minimum_minutes']);
  if(c.type==='set_transition_override')closed(c.data,['mode','minutes','route_checked','service_id','note']);
  if(c.type==='request_reschedule'){
    closed(c.data,slotFields);
    for(const key of ['starts_at','ends_at'])if(c.data[key]!==undefined&&c.data[key]!==null&&!instant(c.data[key]))invalid('INVALID_INSTANT','Нужен корректный момент UTC.');
  }
  if(c.type==='apply_group_shift'){
    closed(c.data,['starts_at','direction','duration_minutes']);
    if(!instant(c.data.starts_at)||!['forward','backward'].includes(c.data.direction)||c.data.duration_minutes!==undefined&&(!Number.isSafeInteger(c.data.duration_minutes)||c.data.duration_minutes<=0||c.data.duration_minutes>1000000))invalid('INVALID_GROUP_SHIFT','Нужно явное направление, UTC начало и положительная длительность.');
  }
}
export function scheduleAllocations(c){
  if(c.type.startsWith('set_')&&Object.hasOwn(scheduleFields,c.type)&&c.expected_version===0)return ['link'];
  if(c.type==='request_reschedule')return ['request','item'];
  return [];
}
function validateConstraint(c){
  const v=JSON.parse(c.values_json),fields={fixed_start:['at','timezone'],fixed_interval:['start','end','start_timezone','end_timezone'],window:['start','end','start_timezone','end_timezone'],date_range:['date_start','date_end','timezone'],min_duration:['minutes'],max_duration:['minutes']};
  if(!Object.hasOwn(fields,c.kind))invalid('INVALID_CONSTRAINT','Неизвестное ограничение.');closed(v,fields[c.kind]);
  textField(c.reason,'Причина ограничения',2000,true);
  if(c.kind==='fixed_start'&&!instant(v.at))invalid('INVALID_CONSTRAINT','Укажите момент UTC.');
  if(['fixed_interval','window'].includes(c.kind)&&(!instant(v.start)||!instant(v.end)||Date.parse(v.start)>=Date.parse(v.end)))invalid('INVALID_CONSTRAINT','Нужен положительный интервал UTC.');
  if(c.kind==='date_range'&&(!validDate(v.date_start)||!validDate(v.date_end)||v.date_start>v.date_end||!zoneValid(v.timezone)))invalid('INVALID_CONSTRAINT','Нужны корректные даты и пояс.');
  if(['min_duration','max_duration'].includes(c.kind)&&(!Number.isSafeInteger(v.minutes)||v.minutes<=0||v.minutes>1000000))invalid('INVALID_CONSTRAINT','Нужна положительная длительность.');
  for(const key of ['timezone','start_timezone','end_timezone'])if(v[key]!==undefined&&!zoneValid(v[key]))invalid('INVALID_TIMEZONE','Некорректный пояс ограничения.');
  if(c.source_url!==null){try{if(!['https:','http:'].includes(new URL(c.source_url).protocol))throw Error();}catch{invalid('INVALID_URL','Нужна ссылка HTTP или HTTPS.');}}
}
const collectionFor={set_time_constraint:'constraints',remove_time_constraint:'constraints',set_time_link:'time_links',remove_time_link:'time_links',set_transition_override:'transition_overrides',remove_transition_override:'transition_overrides'};
export function scheduleContext(ctx){
  const {sources:s,before,ids,audit,mark,trip,root,actorId,now,createItem,validatePlacement}=ctx;
  const groups=[],requests=new Set(),approved=new Set(),planEdits=new Set();
  const resolved=ids;
  function pRef(value){const id=reference(value,ids,'placement'),p=s.placements.find(p=>p.id===id);if(!live(p)||!s.items.some(i=>i.id===p.item_id&&live(i)))invalid('TARGET_UNAVAILABLE','Пункт недоступен.',404);return p;}
  function version(collection,row,c){checkVersion(before[collection].find(v=>v.id===row?.id)||row,c);}
  function add(collection,id,values){if(!validId(id)||s[collection].some(r=>r.id===id))invalid('ID_CONFLICT','ID уже занят.',409);const row={id,trip_id:trip.id,...values,...audit};s[collection].push(row);mark(collection,row);return row;}
  function touch(p){mark('placements',p);mark('items',s.items.find(i=>i.id===p.item_id));}
  function writable(p){const item=s.items.find(i=>i.id===p.item_id);if(['done','cancelled'].includes(item.state))invalid('ADVANCED_CHANGE_REQUIRED','Исторический пункт нельзя переместить этой командой.');}
  function updateSlot(p,data){
    writable(p);Object.assign(p,data);
    for(const [at,date,tz] of [['starts_at','date_start','start_timezone'],['ends_at','date_end','end_timezone']])if(p[at]&&zoneValid(p[tz])&&!Object.hasOwn(data,date))p[date]=dayInZone(p[at],p[tz]);
    validatePlacement(p,s.items.find(i=>i.id===p.item_id));touch(p);planEdits.add(p.id);
  }
  function apply(c){
    if(['approve_placement','make_tentative','apply_group_shift','request_reschedule'].includes(c.type)){
      const p=pRef(c.id);version('placements',p,c);writable(p);
      if(c.type==='approve_placement'){if(!activePlacement(s,p))invalid('PLACEMENT_CONTEXT_REQUIRED','Утверждение доступно в рабочем варианте.');p.commitment='approved';approved.add(p.id);touch(p);}
      if(c.type==='make_tentative'){textField(c.reason,'Причина',2000,true);p.commitment='tentative';p.approved_context_json=null;approved.delete(p.id);touch(p);}
      if(c.type==='apply_group_shift'){
        if(groups.length)invalid('ONE_GROUP_PER_PACKAGE','В пакете допускается один групповой перенос.');
        const group=groupShift(s,p.id,c.data,now);groups.push(group);
        for(const change of group.changes)updateSlot(pRef(change.placement_id),change.after);
      }
      if(c.type==='request_reschedule'){
        textField(c.reason,'Причина запроса',2000,true);
        const original={...p},data={...c.data};
        if(data.starts_at&&!Object.hasOwn(data,'ends_at')&&p.starts_at&&p.ends_at)data.ends_at=new Date(Date.parse(data.starts_at)+Date.parse(p.ends_at)-Date.parse(p.starts_at)).toISOString();
        updateSlot(p,data);p.commitment='tentative';p.approved_context_json=null;approved.delete(p.id);requests.add(p.id);
        const services=[...new Map([...boundServices(before,before.placements.find(x=>x.id===p.id)||original,now),...boundServices(s,p,now)].map(v=>[v.id,v])).values()],previous=s.reschedule_requests.find(r=>live(r)&&r.placement_id===p.id&&r.state==='open');
        let task;
        if(c.task_id){const id=reference(c.task_id,ids,'item');task=s.items.find(t=>live(t)&&t.id===id&&t.kind==='task'&&['open','in_progress'].includes(t.state));if(!task)invalid('TASK_NOT_OPEN','Нужна открытая задача.');}
        if(!task&&previous)task=s.items.find(t=>live(t)&&t.id===previous.task_id&&['open','in_progress'].includes(t.state));
        if(!task){const related=[...new Set(s.service_tasks.filter(l=>live(l)&&services.some(v=>v.id===l.service_id)&&['exchange','review'].includes(l.action)).map(l=>l.task_id))].map(id=>s.items.find(t=>t.id===id)).filter(t=>live(t)&&['open','in_progress'].includes(t.state));if(related.length>1)invalid('AMBIGUOUS_PREPARATION','Укажите задачу для пересмотра.');task=related[0];}
        if(!task)task=createItem(ids[c.key].item,null,{kind:'task',title:'Проверить перенос: '+s.items.find(i=>i.id===p.item_id).title});
        resolved[c.key].item=task.id;
        const values={placement_id:p.id,task_id:task.id,desired_json:JSON.stringify(Object.fromEntries(slotFields.map(k=>[k,p[k]]))),sources_json:JSON.stringify(placementSourceSnapshot(before,original,now)),reason:c.reason,state:'open'};
        const request=previous||add('reschedule_requests',ids[c.key].request,values);if(previous){Object.assign(request,values);mark('reschedule_requests',request);}resolved[c.key].request=request.id;
        for(const [i,service] of services.entries()){
          if(!s.service_tasks.some(l=>live(l)&&l.service_id===service.id&&l.task_id===task.id&&['exchange','review'].includes(l.action))){const action=JSON.parse(service.terms_json).change_policy==='forbidden'?'review':'exchange';add('service_tasks',request.id+'_v'+(previous?previous.version+1:1)+'_'+i,{service_id:service.id,task_id:task.id,action});}
        }
        mark('items',task);
      }
      return;
    }
    if(c.type==='close_reschedule_request'){
      const id=reference(c.id,ids,'request'),r=s.reschedule_requests.find(r=>r.id===id);version('reschedule_requests',r,c);textField(c.reason,'Причина закрытия',2000,true);r.state='closed';r.reason=c.reason;mark('reschedule_requests',r);return;
    }
    const collection=collectionFor[c.type],removing=c.type.startsWith('remove_');let row;
    if(c.expected_version===0){row=add(collection,ids[c.key].link,{});}
    else{row=s[collection].find(r=>r.id===reference(c.id,ids,'link'));version(collection,row,c);}
    if(removing){if(c.type==='remove_time_constraint')textField(c.reason,'Причина снятия ограничения',2000,true);row.archived_at=now;row.archived_by=actorId;mark(collection,row);return;}
    if(c.type==='set_time_constraint'){
      const p=pRef(c.placement_id);if(row.placement_id&&row.placement_id!==p.id)invalid('LINK_OWNER_CHANGED','Нельзя переназначить ограничение.');
      Object.assign(row,{placement_id:p.id,kind:c.data.kind===undefined?row.kind:c.data.kind,values_json:c.data.values===undefined?row.values_json:JSON.stringify(c.data.values),reason:c.data.reason===undefined?row.reason:c.data.reason,source_url:c.data.source_url===undefined?row.source_url??null:c.data.source_url,origin:row.origin||'manual'});validateConstraint(row);
    }else{
      const from=pRef(c.from_placement_id),to=pRef(c.to_placement_id);if(from.id===to.id||!compatibleScopes(s,from.scope_id,to.scope_id))invalid('INVALID_TIME_LINK','Нужны разные пункты совместимых областей.');
      if(row.from_placement_id&&(row.from_placement_id!==from.id||row.to_placement_id!==to.id))invalid('LINK_OWNER_CHANGED','Пара существующей связи не меняется.');
      Object.assign(row,{from_placement_id:from.id,to_placement_id:to.id});
      if(c.type==='set_time_link'){
        const shared=scopePath(s,from.scope_id).filter(a=>scopePath(s,to.scope_id).some(b=>b.id===a.id)).at(-1);
        Object.assign(row,{scope_id:shared.id,relation:'finish_before_start',minimum_minutes:c.data.minimum_minutes===undefined?row.minimum_minutes:c.data.minimum_minutes});
        if(!Number.isSafeInteger(row.minimum_minutes)||row.minimum_minutes<0||row.minimum_minutes>1000000)invalid('INVALID_MINIMUM','Некорректный минимальный интервал.');
      }else{
        const mode=c.data.mode===undefined?row.mode:c.data.mode;if(!['accepted','manual','disabled'].includes(mode))invalid('INVALID_BUFFER_MODE','Неизвестный режим запаса.');
        const serviceId=c.data.service_id===undefined?row.service_id??null:c.data.service_id===null?null:reference(c.data.service_id,ids,'service');
        const service=serviceId?s.services.find(v=>live(v)&&v.id===serviceId):null;if(serviceId&&!service)invalid('TARGET_UNAVAILABLE','Услуга недоступна.',404);
        const suggestion=transition({...s,transition_overrides:[]},from,to,now).suggested_minutes;
        let minutes=mode==='disabled'?0:mode==='accepted'?suggestion:c.data.minutes===undefined?row.minutes:c.data.minutes;
        if(minutes===null||!Number.isSafeInteger(minutes)||minutes<0||minutes>1000000||mode!=='manual'&&c.data.minutes!==undefined)invalid('INVALID_BUFFER_MINUTES','Для дальнего перехода нужен ручной запас; автоматическое значение не подменяется.');
        const checked=c.data.route_checked===undefined?Boolean(row.route_checked):c.data.route_checked,note=c.data.note===undefined?row.note??'':c.data.note;
        if(typeof checked!=='boolean')invalid('INVALID_ROUTE_CHECK','Нужен явный признак проверки.');textField(note,'Пояснение перехода',2000,mode==='disabled');
        Object.assign(row,{context_hash:transitionContext(s,from,to,serviceId),mode,minutes,route_checked:Number(checked),service_id:serviceId,source_service_version:service?.version??null,note});
      }
    }
    mark(collection,row);
  }
  function finish(commands){
    const seen=new Set();for(const l of s.time_links.filter(live)){const key=l.from_placement_id+':'+l.to_placement_id;if(seen.has(key))invalid('DUPLICATE_LINK','Связь уже существует.');seen.add(key);}
    const done=new Set(),visiting=new Set();const visit=id=>{if(visiting.has(id))invalid('TIME_LINK_CYCLE','Временное предшествование образует цикл.');if(done.has(id))return;visiting.add(id);for(const l of s.time_links.filter(l=>live(l)&&l.from_placement_id===id))visit(l.to_placement_id);visiting.delete(id);done.add(id);};for(const p of s.placements)visit(p.id);
    const unique=new Set();for(const o of s.transition_overrides.filter(live)){const key=canonical([o.from_placement_id,o.to_placement_id,o.context_hash]);if(unique.has(key))invalid('DUPLICATE_LINK','Для контекста уже задан запас.');unique.add(key);}
    for(const c of commands.filter(c=>c.type==='upsert_placement'))planEdits.add(reference(c.id,ids,'placement'));
    for(const c of commands.filter(c=>c.type==='restore_item')){const id=reference(c.id,ids,'item');for(const p of s.placements.filter(p=>p.item_id===id))planEdits.add(p.id);}
    return {groups,requests,approved,planEdits};
  }
  return {apply,finish,approved};
}
function placementSourceSnapshot(s,p,now){return placementConstraints(s,p,now);}

export function scheduleOutcome(before,s,state,now){
  const previous=deriveSchedule(before,now),schedule=deriveSchedule(s,now),issues=[...schedule.issues,...state.groups.flatMap(g=>g.issues)],allowed=[];
  const identity=i=>canonical([i.code,i.refs.map(r=>r.id).sort(),i.sources.map(x=>[x.type,x.id,x.rule]).sort()]);
  const magnitude=i=>i.values.shortfall_minutes??i.values.overlap_minutes??i.values.difference??1;
  for(const issue of schedule.issues){
    const affected=issue.refs.some(r=>state.planEdits.has(r.id)||state.approved.has(r.id)),approval=issue.refs.some(r=>state.approved.has(r.id));
    const old=previous.issues.find(x=>identity(x)===identity(issue)&&x.hard===issue.hard);
    const newOrWorse=!old||magnitude(issue)>magnitude(old)||['PIN_MISMATCH','WINDOW_VIOLATION','DURATION_VIOLATION'].includes(issue.code)&&canonical(old.values)!==canonical(issue.values);
    if(issue.hard&&affected&&(approval||newOrWorse))issue.blocking=true;
    if(['PIN_MISMATCH','WINDOW_VIOLATION','DURATION_VIOLATION'].includes(issue.code)&&issue.refs.every(r=>state.requests.has(r.id)&&!state.approved.has(r.id)&&s.placements.some(p=>p.id===r.id&&p.commitment==='tentative'))&&affected){issue.blocking=false;issue.acknowledgement_required=true;allowed.push(issue.key);}
    if(approval&&issue.code==='TIME_INCOMPLETE'){issue.blocking=true;}
  }
  // Releasing an actual binding leaves the still-active supplier fact visible and requires precise acknowledgement.
  for(const p of before.placements.filter(p=>activePlacement(before,p))){
    const old=boundServices(before,p,now),next=s.placements.find(x=>x.id===p.id),current=next&&activePlacement(s,next)?boundServices(s,next,now):[];
    const released=old.filter(v=>!current.some(x=>x.id===v.id)&&s.services.some(x=>x.id===v.id&&['confirmed','held'].includes(x.state)));
    if(!released.length)continue;
    const issue=scheduleIssue('BOOKING_BINDING_RELEASED',[p],{service_ids:released.map(v=>v.id)},released.map(v=>({type:'service',id:v.id,version:v.version})));issue.acknowledgement_required=true;issues.push(issue);allowed.push(issue.key);
  }
  const groupIds=new Set(state.groups.flatMap(g=>g.changes.map(c=>c.placement_id)));
  for(const issue of schedule.issues)if(issue.refs.some(r=>groupIds.has(r.id))&&(['SCHEDULE_OVERLAP','TRANSITION_BUFFER_SHORT','TRANSITION_CONDITION_SHORT','LONG_TRANSFER_REVIEW','TIME_LINK_VIOLATION','TIME_LINK_INCOMPLETE','TIME_INCOMPLETE'].includes(issue.code)||issue.hard)){
    if(issue.code==='LONG_TRANSFER_REVIEW'&&issue.values.resolved)continue;
    issue.blocking=true;
  }
  for(const p of schedule.placements)if(state.approved.has(p.id)&&p.commitment==='approved'&&!p.complete){const issue=scheduleIssue('APPROVAL_TIME_INCOMPLETE',[p.id],{},[],'error',true);issue.blocking=true;issues.push(issue);}
  return {schedule,issues,groups:state.groups,can_apply:!issues.some(i=>i.blocking),allowed_acknowledgements:[...new Set(allowed)].sort()};
}
