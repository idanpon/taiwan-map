import {civil,zoneAt,localInstants} from './trip-timezones.js';
export const planningConfig=Object.freeze({soonDays:7,monthPreview:3,maxItems:1000});
export const kindLabels={task:'Задача',decision:'Решение',visit:'Пункт маршрута'};
export const stateLabels={open:'Открыта',in_progress:'В работе',done:'Выполнена',cancelled:'Отменена'};
export const priorityLabels={low:'Низкий',normal:'Обычный',high:'Высокий',critical:'Критичный'};
const priorityRank=new Map(Object.keys(priorityLabels).map((priority,rank)=>[priority,rank]));
const normalPriorityRank=priorityRank.get('normal');
export function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value}
export function validZone(value){try{new Intl.DateTimeFormat('en',{timeZone:value}).format();return typeof value==='string'&&value.length<100}catch{return false}}
const atZone=(value,zone)=>typeof zone==='string'?zone:zoneAt(value,zone).zone;
export function dayInZone(value=new Date(),zone='Asia/Taipei'){return civil(value,atZone(value,zone)).day}
export function addDays(day,number){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+number);return d.toISOString().slice(0,10)}
export function monday(day){const weekday=new Date(day+'T12:00:00Z').getUTCDay();return addDays(day,-((weekday+6)%7))}
export function monthDays(day){const first=monday(day.slice(0,7)+'-01');return Array.from({length:42},(_,i)=>addDays(first,i))}
export function itemDates(item,zone){if(item.kind==='visit'&&typeof zone==='string'||!item.starts_at&&!item.ends_at)return [item.date_start||item.date_end,item.date_end||item.date_start];return [dayInZone(item.starts_at||item.ends_at,zone),dayInZone(item.ends_at||item.starts_at,zone)].sort()}
export function onDay(item,day,zone){const [start,end]=itemDates(item,zone);return Boolean(start&&start<=day&&end>=day)}
export function urgency(item,{now=new Date(),zone='Asia/Taipei'}={}){
 if(['done','cancelled'].includes(item.state))return {kind:'quiet',label:item.kind==='visit'?(item.state==='done'?'Состоялось':'Пропустили'):stateLabels[item.state]};
 const today=dayInZone(now,zone),[start,end]=itemDates(item,zone);if(!start)return {kind:'quiet',label:'Без срока'};
 const instant=item.ends_at||item.starts_at,exactEnd=instant?new Date(instant):null;
 if(exactEnd?exactEnd<now:end<today){const days=Math.max(0,Math.round((new Date(today)-new Date(end))/86400000));return {kind:'overdue',label:days?'Просрочено на '+days+' дн.':'Срок прошёл'}}
 if(end===today)return {kind:'current',label:start<today?'До сегодня':'Сегодня'};
 if(start<=today&&end>=today)return {kind:'current',label:'Период идёт'};
 if(start<=addDays(today,planningConfig.soonDays))return {kind:'soon',label:'Скоро'};
 return {kind:'quiet',label:''};
}
export function sortItems(items){
 return [...items].sort((a,b)=>
  (a.sort_order-b.sort_order)||
  (a.starts_at||'').localeCompare(b.starts_at||'')||
  ((priorityRank.get(b.priority)??normalPriorityRank)-(priorityRank.get(a.priority)??normalPriorityRank))||
  a.title.localeCompare(b.title,'ru'));
}
// Convert an explicitly chosen wall-clock time, never the server/device default.
// Reject nonexistent and ambiguous DST times instead of silently moving them.
export function zonedInstant(day,time,zone){
 const candidates=localInstants(day,time,zone);
 if(candidates.length!==1)throw new Error('Это время пропущено или повторяется при смене часового пояса. Выберите другое время.');
 return new Date(candidates[0]).toISOString();
}
export function timeInZone(instant,zone){return civil(instant,atZone(instant,zone)).time}
export function dateLabel(day){return day?new Intl.DateTimeFormat('ru',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z')):''}
