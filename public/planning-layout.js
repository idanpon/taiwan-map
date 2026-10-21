import {itemDates,addDays,sortItems} from './planning-model.js';

// One segment per record per visible week. Inclusive dates; lanes never overlap.
export function weekSegments(items,firstDay,zone){
 const lastDay=addDays(firstDay,6),days=Array.from({length:7},(_,n)=>addDays(firstDay,n));
 const segments=sortItems(items).map(item=>{
  const [start,end]=itemDates(item,zone);
  if(!start||end<firstDay||start>lastDay)return null;
  const first=start<firstDay?firstDay:start,last=end>lastDay?lastDay:end;
  return {item,start,end,column:days.indexOf(first),span:days.indexOf(last)-days.indexOf(first)+1,continuesBefore:start<firstDay,continuesAfter:end>lastDay};
 }).filter(Boolean).sort((a,b)=>a.column-b.column||b.span-a.span);
 const lanes=[];
 for(const segment of segments){let lane=lanes.findIndex(end=>end<segment.column);if(lane<0)lane=lanes.length;lanes[lane]=segment.column+segment.span-1;segment.lane=lane}
 return segments;
}
export function isPeriod(item,zone){const [start,end]=itemDates(item,zone);return Boolean(start&&end>start)}
