import { invalid, zoneValid, textField } from './planning-domain-common.js';
import { validDate, dayInZone } from './planning-model.js';
import { civil, localInstants } from './trip-timezones.js';
import { live, activePlacement } from './planning-readiness.js';

const instant=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/.test(v)&&validDate(v.slice(0,10))&&Number.isFinite(Date.parse(v));
export function validateDeadline(d){
  if(Boolean(d.task_id)===Boolean(d.service_id)||!['target','sales_open','sales_close','payment','cancel_by','check_in'].includes(d.kind)||!zoneValid(d.timezone))invalid('INVALID_DEADLINE','Проверьте владельца, тип и часовой пояс срока.');
  if((d.kind==='target')!==Boolean(d.task_id))invalid('INVALID_DEADLINE_OWNER','Целевой срок принадлежит задаче, внешние сроки — услуге.');
  if(!['manual','provider'].includes(d.origin)||(d.kind==='target'&&!['manual','relative'].includes(d.mode))||(d.kind!=='target'&&d.mode!==null))invalid('INVALID_DEADLINE_MODE','Некорректный источник или режим срока.');
  if(d.at!==null&&!instant(d.at)||d.local_date!==null&&!validDate(d.local_date)||d.at!==null&&d.local_date!==null||d.mode!=='relative'&&d.at===null&&d.local_date===null)invalid('INVALID_DEADLINE_TIME','Нужен момент или календарная дата.');
  if(d.source_url!==null){try{if(!['https:','http:'].includes(new URL(d.source_url).protocol))throw Error();}catch{invalid('INVALID_URL','Некорректная ссылка срока.');}}
  textField(d.note,'Примечание к сроку',2000);
}
export function validateDeadlineRule(r,s){
  if(!['start','end'].includes(r.anchor)||![0,1].includes(r.enabled)||!zoneValid(r.rule_timezone)||(r.offset_minutes===null)===(r.offset_days===null))invalid('INVALID_DEADLINE_RULE','Укажите один способ смещения: минуты или календарные дни.');
  for(const key of ['offset_minutes','offset_days'])if(r[key]!==null&&(!Number.isSafeInteger(r[key])||Math.abs(r[key])>(key==='offset_days'?3660:5270400)))invalid('INVALID_DEADLINE_OFFSET','Слишком большое или дробное смещение.');
  if(!s.deadlines.some(d=>live(d)&&d.task_id===r.task_id&&d.kind==='target'&&d.mode==='relative'))invalid('RELATIVE_TARGET_REQUIRED','Правило требует относительный целевой срок задачи.');
}
const offsetDay=(date,days)=>{const t=Date.parse(date)+days*86400000;if(!Number.isFinite(t))return null;const d=new Date(t).toISOString().slice(0,10);return validDate(d)?d:null;};
export function computeRelativeTarget(s,d){
  const rules=(s.deadline_rules||[]).filter(r=>live(r)&&r.enabled&&r.task_id===d.task_id),values=[];
  for(const r of rules){
    const p=s.placements.find(p=>p.id===r.anchor_placement_id);
    if(!activePlacement(s,p))continue;
    const at=p[r.anchor==='start'?'starts_at':'ends_at'],date=p[r.anchor==='start'?'date_start':'date_end'];
    if(r.offset_minutes!==null){
      if(!at)return {at:null,local_date:null,complete:false,reason:'ANCHOR_TIME_UNKNOWN'};
      const shifted=new Date(Date.parse(at)+r.offset_minutes*60000).toISOString();
      if(!instant(shifted))return {at:null,local_date:null,complete:false,reason:'TARGET_OUT_OF_RANGE'};
      values.push({at:shifted,local_date:null});
    }else if(at){
      const point=civil(Date.parse(at),r.rule_timezone),day=offsetDay(point.day,r.offset_days);
      const possible=day?localInstants(day,point.time,r.rule_timezone):[];
      if(possible.length!==1)return {at:null,local_date:null,complete:false,reason:'LOCAL_TIME_AMBIGUOUS'};
      // Preserve seconds/milliseconds for a calendar-day offset.
      values.push({at:new Date(possible[0]+Date.parse(at)%60000).toISOString(),local_date:null});
    }else if(date){const day=offsetDay(date,r.offset_days);if(!day)return {at:null,local_date:null,complete:false,reason:'ANCHOR_DATE_UNKNOWN'};values.push({at:null,local_date:day});}
    else return {at:null,local_date:null,complete:false,reason:'ANCHOR_DATE_UNKNOWN'};
  }
  if(!values.length)return {at:null,local_date:null,complete:false,reason:'NO_ACTIVE_RULES'};
  if(values.every(v=>v.at))return {...values.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))[0],complete:true,reason:null};
  // Preserve date precision instead of inventing a midnight deadline.
  const earliest=values.map(v=>v.local_date||dayInZone(v.at,d.timezone)).sort()[0];
  return {at:null,local_date:earliest,complete:true,reason:null};
}
export function deadlineProjection(s){
  return (s.deadlines||[]).filter(live).map(d=>{
    const task=d.task_id?s.items.find(i=>i.id===d.task_id):null,frozen=task?.state==='done';
    const relative=d.mode==='relative'&&!frozen?computeRelativeTarget(s,d):{at:d.at,local_date:d.local_date,complete:Boolean(d.at||d.local_date),reason:null};
    return {id:d.id,task_id:d.task_id,service_id:d.service_id,frozen,...relative};
  });
}
export function recalculateDeadlines({sources:s,before,mark}){
  for(const d of s.deadlines.filter(live)){
    if(!d.task_id)continue;
    const item=s.items.find(i=>i.id===d.task_id),old=before.items.find(i=>i.id===item.id);
    // Completion freezes the last calculation. An explicit correction to the deadline remains possible.
    if(d.mode==='relative'&&!(item.state==='done'&&old?.state==='done')){
      const result=computeRelativeTarget(s,d);
      if(d.at!==result.at||d.local_date!==result.local_date){d.at=result.at;d.local_date=result.local_date;mark('deadlines',d);}
    }
    if(item.state==='done'&&old?.state==='done')continue;
    const oldDeadline=before.deadlines.find(x=>x.id===d.id);
    if(oldDeadline&&oldDeadline.at===d.at&&oldDeadline.local_date===d.local_date&&oldDeadline.timezone===d.timezone)continue;
    // A legacy work period remains a period; its reminders keep their original anchor.
    if(old?.date_start&&old?.date_end&&old.date_start!==old.date_end||old?.starts_at&&old?.ends_at)continue;
    const date=d.local_date||(d.at?dayInZone(d.at,d.timezone):null);
    const projection={date_start:old?.date_start?date:null,date_end:old?.date_start&&!old?.date_end?null:date,starts_at:d.at,ends_at:null,event_timezone:d.timezone};
    if(Object.keys(projection).some(k=>item[k]!==projection[k])){Object.assign(item,projection);mark('items',item);}
  }
  // Removing a target removes only its compatibility projection, never a legacy work period.
  for(const old of before.deadlines.filter(d=>live(d)&&d.task_id&&d.kind==='target')){
    if(s.deadlines.some(d=>live(d)&&d.task_id===old.task_id&&d.kind==='target'))continue;
    const item=s.items.find(i=>i.id===old.task_id),previous=before.items.find(i=>i.id===old.task_id);
    if(!item||item.state==='done'||previous?.date_start&&previous?.date_end&&previous.date_start!==previous.date_end||previous?.starts_at&&previous?.ends_at)continue;
    Object.assign(item,{date_start:null,date_end:null,starts_at:null,ends_at:null});mark('items',item);
  }
}
