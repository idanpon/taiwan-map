import {TRIP} from '../src/auth.mjs';
import {all,one,run,transaction} from '../src/sqlite.mjs';
import {readZonePlan,reminderAnchor} from '../src/reminders.mjs';
import {recordPushResult} from '../src/notifications.mjs';
import {localPoint,minute} from '../public/trip-timezones.js';
import {dateLabel} from '../public/planning-model.js';

export const pushTiming=Object.freeze({interval:15000,window:15*minute,ttl:60*minute,attempts:3,batch:24});
const eligibility=`d.enabled=1 AND d.expired=0 AND d.enabled_from<=r.fires_at
 AND d.user_id=r.user_id AND s.user_id=r.user_id AND s.expires_at>?
 AND u.disabled=0 AND COALESCE(p.paused,0)=0 AND COALESCE(p.enabled_from,0)<=r.fires_at
 AND r.enabled=1 AND i.state IN ('open','in_progress') AND i.trip_id=?`;
const joins=`JOIN users u ON u.id=r.user_id JOIN memberships m ON m.user_id=r.user_id AND m.trip_id=i.trip_id
 JOIN sessions s ON s.token_hash=d.session_hash LEFT JOIN notification_preferences p ON p.user_id=r.user_id`;
function enqueue(db,now){
 const rows=all(db,`SELECT r.id reminder_id,r.generation,r.fires_at,i.starts_at,d.id device_id
  FROM planning_reminders r JOIN planning_items i ON i.id=r.item_id JOIN push_devices d ON d.user_id=r.user_id ${joins}
  WHERE ${eligibility} AND r.fires_at>? AND r.fires_at<=?
   AND NOT EXISTS (SELECT 1 FROM push_deliveries q WHERE q.reminder_id=r.id AND q.generation=r.generation AND q.device_id=d.id)
  ORDER BY r.fires_at LIMIT 200`,now,TRIP,now-pushTiming.window,now);
 for(const row of rows){
  const start=row.starts_at?Date.parse(row.starts_at):Infinity;
  const expires=Math.min(row.fires_at+pushTiming.ttl,start>row.fires_at?start:Infinity);
  if(expires<=now)continue;
  run(db,`INSERT OR IGNORE INTO push_deliveries(id,reminder_id,generation,device_id,state,next_at,expires_at)
   VALUES(?,?,?,?,'queued',?,?)`,crypto.randomUUID(),row.reminder_id,row.generation,row.device_id,now,expires);
 }
}
function claim(db,id,now){
 return transaction(db,()=>{
  const row=one(db,`SELECT q.id delivery_id,q.attempts,q.expires_at,r.id reminder_id,r.generation,
    i.id item_id,i.title,i.date_start,i.date_end,i.starts_at,i.ends_at,d.*
   FROM push_deliveries q JOIN planning_reminders r ON r.id=q.reminder_id
   JOIN planning_items i ON i.id=r.item_id JOIN push_devices d ON d.id=q.device_id ${joins}
   WHERE q.id=? AND q.state='queued' AND q.generation=r.generation AND q.expires_at>?
    AND r.fires_at<=? AND ${eligibility}`,id,now,now,now,TRIP);
  if(!row){run(db,"UPDATE push_deliveries SET state='expired' WHERE id=? AND state='queued'",id);return null}
  run(db,"UPDATE push_deliveries SET state='sending',attempts=attempts+1 WHERE id=?",id);
  return row;
 });
}
function payload(db,row){
 const anchor=reminderAnchor(row),plan=readZonePlan(db);
 let body='';
 if(anchor?.mode==='offset'){
  const point=localPoint(anchor.at,plan);
  body=dateLabel(point.day)+' · '+point.time+' · '+point.badge;
 }else if(anchor)body=dateLabel(anchor.day)+(row.date_start&&row.date_end&&row.date_start!==row.date_end?' — '+dateLabel(row.date_end):'');
 return {title:row.title,body,path:'planning.html#item='+encodeURIComponent(row.item_id),tag:'taiwan-'+row.reminder_id+'-'+row.generation,owner:row.user_id};
}
export function createPushScheduler(db,send,{now=Date.now,onError=()=>{}}={}){
 let running=null,timer=null;
 // An interrupted network handoff has unknown delivery status. Do not retry it.
 // Queued sends and known transient rejections survive a process restart.
 run(db,"UPDATE push_deliveries SET state='failed' WHERE state='sending'");
 async function tick(){
  const started=now();
  transaction(db,()=>{
   run(db,"UPDATE push_deliveries SET state='expired' WHERE state='queued' AND expires_at<=?",started);
   // Keep delivery records until their generation is retired; uniqueness
   // prevents duplicate provider requests while a reminder is still due.
   run(db,"DELETE FROM push_deliveries WHERE expires_at<?",started-14*86400000);
   enqueue(db,started);
  });
  const ids=all(db,"SELECT id FROM push_deliveries WHERE state='queued' AND next_at<=? ORDER BY next_at,id LIMIT ?",started,pushTiming.batch);
  for(let i=0;i<ids.length;i+=4)await Promise.all(ids.slice(i,i+4).map(async({id})=>{
   const time=now(),row=claim(db,id,time);
   if(!row)return;
   let result;
   try{result=await send(row,payload(db,row),Math.max(1,Math.floor((row.expires_at-time)/1000)))}catch{result='failed'}
   const finished=now();
   transaction(db,()=>{
    recordPushResult(db,row,result,finished);
    if(result==='sent')run(db,'UPDATE planning_reminders SET sent_generation=? WHERE id=? AND generation=?',row.generation,row.reminder_id,row.generation);
    const next=finished+minute*2**row.attempts;
    const retry=result==='retry'&&row.attempts+1<pushTiming.attempts&&next<row.expires_at;
    run(db,"UPDATE push_deliveries SET state=?,next_at=? WHERE id=? AND state='sending'",
     retry?'queued':result==='sent'?'sent':result==='expired'?'expired':'failed',next,id);
   });
  }));
 }
 const runTick=()=>running??=(tick().finally(()=>{running=null}));
 return {
  tick:runTick,
  start(){if(timer)return;const invoke=()=>runTick().catch(onError);timer=setInterval(invoke,pushTiming.interval);timer.unref();invoke()},
  async stop(){clearInterval(timer);timer=null;await running?.catch(onError)}
 };
}
