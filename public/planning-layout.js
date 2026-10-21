import {itemDates,addDays,sortItems} from './planning-model.js';

// One segment per record per visible week. Inclusive dates; lanes never overlap.
export function weekSegments(items,firstDay,zone){
 const lastDay=addDays(firstDay,6),days=Array.from({length:7},(_,n)=>addDays(firstDay,n));
 const segments=sortItems(items).map(item=>{
  const [start,end]=itemDates(item,zone);
  if(!start||end<firstDay||start>lastDay)return null;
  const first=start<firstDay?firstDay:start,last=end>lastDay?lastDay:end;
  return {item,start,end,column:days.indexOf(first),span:days.indexOf(last)-days.indexOf(first)+1,continuesBefore:start<firstDay,continuesAfter:end>lastDay};
 }).filter(Boolean).sort((a,b)=>b.span-a.span||a.column-b.column);
 const lanes=[];
 // Longest first can place an earlier short record after a later long one.
 // Occupancy masks handle both directions and reuse gaps without collisions.
 for(const segment of segments){const mask=((1<<segment.span)-1)<<segment.column;let lane=lanes.findIndex(used=>(used&mask)===0);if(lane<0)lane=lanes.length;lanes[lane]=(lanes[lane]||0)|mask;segment.lane=lane}
 return segments.sort((a,b)=>a.lane-b.lane||a.column-b.column);
}
export function isPeriod(item,zone){const [start,end]=itemDates(item,zone);return Boolean(start&&end>start)}
