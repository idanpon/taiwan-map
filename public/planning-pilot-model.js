import {addDays,itemDates,monthDays,validDate} from './planning-model.js';
import {localPoint,tripLocalInstants} from './trip-timezones.js';

const dayMilliseconds=86400000;
export const dateFields=['date_start','date_end','starts_at','ends_at','event_timezone'];
export const dateSnapshot=item=>Object.fromEntries(dateFields.map(key=>[key,item[key]??null]));
export function dayDifference(from,to){return Math.round((Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/dayMilliseconds)}
export function recordCount(number){return number+' '+(number%100>=11&&number%100<=14?'записей':number%10===1?'запись':number%10>=2&&number%10<=4?'записи':'записей')}

export function calendarDays(day,items,zone){
 const ranges=items.map(item=>({item,range:itemDates(item,zone)}));
 const days=monthDays(day),last=days.findLastIndex(date=>date.startsWith(day.slice(0,7)));
 return days.slice(0,Math.ceil((last+1)/7)*7).map(date=>({date,items:ranges.filter(({range:[start,end]})=>start&&start<=date&&end>=date).map(row=>row.item)}));
}

// Enumerate occupied intervals, without walking across empty years between records.
// Long periods remain available through an explicit next-page action.
export function listDayGroups(items,zone,anchor,limit=180,today=anchor){
 const rows=items.map(item=>({item,range:itemDates(item,zone)})).filter(row=>row.range[0]);
 const intervals=rows.map(row=>[...row.range]).sort((a,b)=>a[0].localeCompare(b[0])),merged=[];
 for(const range of intervals){const last=merged.at(-1);if(last&&(range[0]<=last[1]||dayDifference(last[1],range[0])===1)){if(range[1]>last[1])last[1]=range[1]}else merged.push(range)}
 const dates=new Set();let hasMore=false;
 outer:for(const [start,end] of merged){for(let day=start;day<=end;day=addDays(day,1)){if(dates.size>=limit){hasMore=true;break outer}dates.add(day);if(day===end)break}}
 if(validDate(today))dates.add(today);
 // Empty neighbours appear as drop destinations during a drag.
 for(let offset=-1;offset<7;offset++){const day=addDays(anchor,offset);if(validDate(day))dates.add(day)}
 return {hasMore,groups:[...dates].sort().map(date=>({date,items:rows.filter(({range:[start,end]})=>start<=date&&end>=date).map(row=>row.item)}))};
}

export function moveDateDraft(item,target,zone,anchor=null){
 if(!validDate(target))throw new Error('Выберите корректную дату.');
 const [start,end]=itemDates(item,zone),delta=start?dayDifference(anchor||start,target):0;
 return {start:start?addDays(start,delta):target,end:item.date_end||item.ends_at?addDays(end,delta):null,delta};
}

// Partial patches deliberately omit notes, relationships, assignees and state.
export function planItemMove(item,target,zone,anchor=null){
 const draft=moveDateDraft(item,target,zone,anchor),[start]=itemDates(item,zone);
 if(start&&draft.delta===0)return {unchanged:true,draft};
 if(item.fixed_external)return {review:'Это фиксированная внешняя дата. Проверьте перенос перед сохранением.',draft};
 const patch=dateSnapshot(item);
 if(!item.starts_at&&!item.ends_at){
  patch.date_start=item.date_start?addDays(item.date_start,draft.delta):item.date_end?null:target;
  patch.date_end=item.date_end?addDays(item.date_end,draft.delta):null;
  return {patch,draft};
 }
 for(const key of ['starts_at','ends_at']){
  if(!item[key])continue;
  const before=localPoint(item[key],zone),day=addDays(before.day,draft.delta),matches=tripLocalInstants(day,before.time,zone);
  if(matches.length!==1)return {review:'На новой дате это время пропускается или встречается дважды. Уточните время и пояс.',draft};
  // Keep seconds/milliseconds too: the editor displays minutes, API values may be more precise.
  const remainder=((Date.parse(item[key])%60000)+60000)%60000;
  patch[key]=new Date(matches[0]+remainder).toISOString();
 }
 if(patch.ends_at&&Date.parse(patch.ends_at)-Date.parse(patch.starts_at)!==Date.parse(item.ends_at)-Date.parse(item.starts_at))
  return {review:'Из-за смены пояса длительность периода изменится. Проверьте оба времени.',draft};
 const first=localPoint(patch.starts_at,zone);
 patch.date_start=first.day;patch.date_end=patch.ends_at?localPoint(patch.ends_at,zone).day:null;patch.event_timezone=first.zone;
 return {patch,draft};
}
