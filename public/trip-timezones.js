export const initialZone=Object.freeze({zone:'Europe/Moscow',region:'Москва',at:null});
export const emptyZonePlan=Object.freeze({revision:1,changes:Object.freeze([])});
export const minute=60000;
const dayMs=86400000,formatters=new Map();
export const validClock=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function namedZone(value){
 if(typeof value!=='string'||value.length>80||!/^(?:UTC|[A-Za-z][\w+.-]*(?:\/[\w+.-]+)+)$/.test(value))return false;
 try{new Intl.DateTimeFormat('en',{timeZone:value});return true}catch{return false}
}
const millis=value=>typeof value==='number'?value:+new Date(value);
function formatter(zone){
 if(!formatters.has(zone)){
  if(formatters.size>=256)formatters.clear();
  formatters.set(zone,new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
 }
 return formatters.get(zone);
}
export function civil(value,zone){
 const parts=Object.fromEntries(formatter(zone).formatToParts(new Date(value)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return {day:parts.year.padStart(4,'0')+'-'+parts.month+'-'+parts.day,time:parts.hour+':'+parts.minute};
}
const wallMillis=(day,time)=>Date.parse(day+'T'+time+':00Z');
function offsetAt(at,zone){
 const {day,time}=civil(at,zone);
 return (wallMillis(day,time)-Math.floor(at/minute)*minute)/minute;
}
export function zoneAt(value,plan=emptyZonePlan){
 const at=millis(value),changes=plan?.changes||[];
 let left=0,right=changes.length;
 while(left<right){const mid=(left+right)>>1;if(changes[mid].at<=at)left=mid+1;else right=mid}
 return left?changes[left-1]:initialZone;
}
export function offsetLabel(offset){
 const h=Math.floor(Math.abs(offset)/60),m=Math.abs(offset)%60;
 return 'UTC'+(offset<0?'−':'+')+h+(m?':'+String(m).padStart(2,'0'):'');
}
export function localPoint(value,plan){
 const at=millis(value),{zone,region}=zoneAt(at,plan),offset=offsetAt(at,zone);
 return {at,zone,region,offset,...civil(at,zone),badge:(region||zone)+' · '+offsetLabel(offset)};
}
export function localInstants(day,time,zone){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day||'')||!validClock(time)||!namedZone(zone))return [];
 const target=wallMillis(day,time);
 if(!Number.isFinite(target)||new Date(target).toISOString().slice(0,10)!==day)return [];
 // Sample offsets surrounding the civil day, then round-trip every candidate.
 // This handles non-hour changes without guessing which side is intended.
 const offsets=new Set();
 for(let step=-2*dayMs;step<=2*dayMs;step+=6*3600000)offsets.add(offsetAt(target+step,zone));
 return [...offsets].map(offset=>target-offset*minute).filter(at=>{const back=civil(at,zone);return back.day===day&&back.time===time}).sort((a,b)=>a-b);
}
function planZones(plan){return [...new Set([initialZone.zone,...(plan?.changes||[]).map(row=>row.zone)])]}
export function tripLocalInstants(day,time,plan){
 return [...new Set(planZones(plan).flatMap(zone=>localInstants(day,time,zone).filter(at=>zoneAt(at,plan).zone===zone)))].sort((a,b)=>a-b);
}
function nearbyJump(day,time,plan){
 const target=wallMillis(day,time),start=target-2*dayMs,end=target+2*dayMs;
 const points=new Set((plan?.changes||[]).filter(row=>row.at>=start&&row.at<=end).map(row=>row.at));
 // A zone can also change its own clock while the itinerary stays in it.
 for(const zone of planZones(plan)){
  let previous=offsetAt(start,zone);
  for(let at=start+6*3600000;at<=end;at+=6*3600000){
   const next=offsetAt(at,zone);
   if(previous!==next){
    let a=at-6*3600000,b=at;
    while(b-a>minute){const mid=Math.floor((a+b)/2/minute)*minute;if(offsetAt(mid,zone)===previous)a=mid;else b=mid}
    if(zoneAt(b,plan).zone===zone)points.add(b);
   }
   previous=next;
  }
 }
 for(const at of [...points].sort((a,b)=>a-b)){
  const before=localPoint(at-minute,plan),after=localPoint(at,plan);
  const from=at+before.offset*minute,to=at+after.offset*minute;
  if(target>=Math.min(from,to)&&target<Math.max(from,to)){
   return {at,before:{...before,...civil(from,'UTC')},after};
  }
 }
 return null;
}
export function localConflict(day,time,plan,previousAt=null){
 const instants=tripLocalInstants(day,time,plan);
 if(instants.length===1)return null;
 const jump=nearbyJump(day,time,plan);
 const previous=Number.isFinite(previousAt)?localPoint(previousAt,plan):null;
 let before,after;
 if(instants.length>1){before=localPoint(instants[0],plan);after=localPoint(instants.at(-1),plan)}
 else if(jump){
  before=previous&&previous.day===day&&previous.at<jump.at?previous:localPoint(jump.at-minute,plan);
  after=previous&&previous.day===day&&previous.at>=jump.at?previous:localPoint(jump.at,plan);
 }
 return {kind:instants.length?'repeat':'gap',day,time,jump,before:before||null,after:after||null,previous};
}
export function resolveLocalChoice(conflict,choice,plan){
 if(!choice||typeof choice!=='object')return null;
 if(choice.kind==='off')return {off:true};
 if(['before','after'].includes(choice.kind))return conflict[choice.kind]||null;
 if(choice.kind!=='custom'||!validClock(choice.time)||!namedZone(choice.zone))return null;
 const matches=tripLocalInstants(conflict.day,choice.time,plan).map(at=>localPoint(at,plan)).filter(p=>p.zone===choice.zone&&(choice.offset===undefined||p.offset===choice.offset));
 return matches.length===1?matches[0]:null;
}
