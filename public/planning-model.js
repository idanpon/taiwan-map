export const planningConfig=Object.freeze({soonDays:7,monthPreview:3,maxItems:1000});
export const kindLabels={task:'Задача',decision:'Решение',visit:'Пункт маршрута'};
export const stateLabels={open:'Открыта',in_progress:'В работе',done:'Выполнена',cancelled:'Отменена'};
export const priorityLabels={low:'Низкий',normal:'Обычный',high:'Высокий',critical:'Критичный'};
export function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value}
export function validZone(value){try{new Intl.DateTimeFormat('en',{timeZone:value}).format();return typeof value==='string'&&value.length<100}catch{return false}}
export function dayInZone(value=new Date(),zone='Asia/Taipei'){return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))}
export function addDays(day,number){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+number);return d.toISOString().slice(0,10)}
export function monday(day){const weekday=new Date(day+'T12:00:00Z').getUTCDay();return addDays(day,-((weekday+6)%7))}
export function monthDays(day){const start=day.slice(0,7)+'-01',first=monday(start);const next=new Date(start+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);const days=Math.round((next-new Date(first+'T12:00:00Z'))/86400000);return Array.from({length:Math.ceil(days/7)*7},(_,i)=>addDays(first,i))}
export function itemDates(item,zone){if(item.kind==='visit'||!item.starts_at&&!item.ends_at)return [item.date_start||item.date_end,item.date_end||item.date_start];return [item.starts_at?dayInZone(item.starts_at,zone):dayInZone(item.ends_at,zone),item.ends_at?dayInZone(item.ends_at,zone):dayInZone(item.starts_at,zone)]}
export function onDay(item,day,zone){const [start,end]=itemDates(item,zone);return Boolean(start&&start<=day&&end>=day)}
export function urgency(item,{now=new Date(),zone='Asia/Taipei'}={}){
 if(['done','cancelled'].includes(item.state))return {kind:'quiet',label:item.kind==='visit'?(item.state==='done'?'Состоялось':'Пропустили'):stateLabels[item.state]};
 const today=dayInZone(now,zone),[start,end]=itemDates(item,zone);if(!start)return {kind:'quiet',label:'Без срока'};
 const exactEnd=item.ends_at?new Date(item.ends_at):null;
 if(end<today||exactEnd&&exactEnd<now){const days=Math.max(0,Math.round((new Date(today)-new Date(end))/86400000));return {kind:'overdue',label:days?'Просрочено на '+days+' дн.':'Срок прошёл'}}
 if(end===today)return {kind:'current',label:start<today?'До сегодня':'Сегодня'};
 if(start<=today&&end>=today)return {kind:'current',label:'Период идёт'};
 if(start<=addDays(today,planningConfig.soonDays))return {kind:'soon',label:'Скоро'};
 return {kind:'quiet',label:''};
}
export function sortItems(items){return [...items].sort((a,b)=>(a.sort_order-b.sort_order)||(a.starts_at||'').localeCompare(b.starts_at||'')||a.title.localeCompare(b.title,'ru'))}
// Convert an explicitly chosen wall-clock time, never the server/device default.
// Reject nonexistent and ambiguous DST times instead of silently moving them.
export function zonedInstant(day,time,zone){
 if(!validDate(day)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!validZone(zone))throw new Error('Проверьте дату, время и часовой пояс.');
 const desired=day+'T'+time,base=Date.parse(desired+':00Z'),fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const wall=ms=>fmt.format(new Date(ms)).replace(' ','T');let guess=base;
 for(let n=0;n<4;n++){const current=wall(guess);guess+=base-Date.parse(current+':00Z')}
 const candidates=[...new Set([-7200000,-3600000,0,3600000,7200000].map(delta=>guess+delta).filter(ms=>wall(ms)===desired))];
 if(candidates.length!==1)throw new Error('Это время пропущено или повторяется при смене часового пояса. Выберите другое время.');
 return new Date(candidates[0]).toISOString();
}
export function timeInZone(instant,zone){return new Intl.DateTimeFormat('ru',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(instant))}
export function dateLabel(day){return day?new Intl.DateTimeFormat('ru',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z')):''}
