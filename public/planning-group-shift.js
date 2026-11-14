import { scheduleNodes, immovable, placementConstraints, scheduleIssue, exact, deriveSchedule, incompleteIntersects } from './planning-schedule.js';
import { transition } from './planning-transitions.js';
import { live, activePlacement } from './planning-readiness.js';
import { dayInZone } from './planning-model.js';
import { resolveRoute, routeIssue } from './planning-scopes.js';

const minute=60000;
export function movedSlot(p,start,duration){
  const end=start+duration;
  return {starts_at:new Date(start).toISOString(),ends_at:new Date(end).toISOString(),date_start:dayInZone(start,p.start_timezone),date_end:dayInZone(end,p.end_timezone),
    intended_duration_minutes:p.intended_duration_minutes===null?null:duration/minute};
}
// Computes a complete proposal on a clone. Caller persists none of it if any boundary fails.
export function groupShift(s,pid,data,now,{suggest=true}={}){
  const working=structuredClone(s),{nodes,incomplete}=scheduleNodes(working),index=nodes.findIndex(n=>n.placement.id===pid&&n.kind!=='stay');
  const originalStarts=new Map(nodes.map(n=>[n.id,n.start]));
  const result={placement_id:pid,direction:data.direction,changes:[],issues:[],boundary:null,nearest_start:null};
  const block=(code,ids,values={})=>{const issue=scheduleIssue(code,ids,values,[],'error',true);issue.blocking=true;result.issues.push(issue);};
  if(index<0||!exact(nodes[index].placement)){block('GROUP_TIME_INCOMPLETE',[pid]);return result;}
  const anchor=nodes[index],start=Date.parse(data.starts_at),duration=data.duration_minutes===undefined?anchor.end-anchor.start:data.duration_minutes*minute;
  const tied=nodes.filter(n=>n.placement.id!==pid&&n.start===anchor.start);
  if(tied.length){block('GROUP_ORDER_AMBIGUOUS',[anchor.placement,...tied.map(n=>n.placement)]);return result;}
  if(data.direction==='forward'&&start<anchor.start||data.direction==='backward'&&(start>anchor.start||duration!==anchor.end-anchor.start)){block('GROUP_DIRECTION_MISMATCH',[pid]);return result;}
  if(immovable(working,anchor,now)){
    // A fixed start can resize its free end; all other boundaries remain immovable.
    const reasons=placementConstraints(working,anchor.placement,now),item=working.items.find(i=>i.id===anchor.placement.item_id);
    if(item.state==='done'||reasons.some(r=>r.kind==='unknown'||r.kind==='fixed_interval'||r.kind==='fixed_start'&&start!==anchor.start)){block('GROUP_FIXED_ANCHOR',[pid],{constraint_ids:reasons.map(r=>r.id)});return result;}
  }
  function move(node,newStart,newDuration){
    const original=s.placements.find(p=>p.id===node.placement.id),slot=movedSlot(node.placement,newStart,newDuration);
    if(slot.starts_at!==original.starts_at||slot.ends_at!==original.ends_at)result.changes.push({placement_id:node.placement.id,before:{starts_at:original.starts_at,ends_at:original.ends_at},after:slot});
    Object.assign(node.placement,slot);node.start=newStart;node.end=newStart+newDuration;
  }
  move(anchor,start,duration);
  const direction=data.direction==='forward'?1:-1;let previous=anchor,boundaryIndex=null;
  for(let i=index+direction;i>=0&&i<nodes.length;i+=direction){
    const next=nodes[i];
    if(originalStarts.get(next.id)===originalStarts.get(nodes[i-direction].id)){block('GROUP_ORDER_AMBIGUOUS',[previous.placement,next.placement]);break;}
    const a=direction===1?previous:next,b=direction===1?next:previous,gap=transition(working,a.placement,b.placement,now);
    if(gap.required_minutes===null){block('GROUP_TRANSITION_UNRESOLVED',[a.placement,b.placement],{distance_m:gap.distance_m,range:gap.range});result.boundary={placement_id:next.placement.id,transition:gap};break;}
    if(!next.complete){block('GROUP_TIME_INCOMPLETE',[next.placement]);result.boundary={placement_id:next.placement.id};break;}
    let needed=direction===1?previous.end+gap.required_minutes*minute:previous.start-gap.required_minutes*minute;
    for(const link of (working.time_links||[]).filter(live)){
      if(direction===1&&link.to_placement_id===next.placement.id){const p=working.placements.find(p=>p.id===link.from_placement_id);if(activePlacement(working,p)){if(!p.ends_at){block('GROUP_TIME_INCOMPLETE',[p,next.placement]);break;}needed=Math.max(needed,Date.parse(p.ends_at)+link.minimum_minutes*minute);}}
      if(direction===-1&&link.from_placement_id===next.placement.id){const p=working.placements.find(p=>p.id===link.to_placement_id);if(activePlacement(working,p)){if(!p.starts_at){block('GROUP_TIME_INCOMPLETE',[p,next.placement]);break;}needed=Math.min(needed,Date.parse(p.starts_at)-link.minimum_minutes*minute);}}
    }
    if(result.issues.length)break;
    const delta=direction===1?Math.max(0,needed-next.start):Math.min(0,needed-next.end);
    if(next.placement.scope_id!==anchor.placement.scope_id||immovable(working,next,now)){
      boundaryIndex=i;result.boundary={placement_id:next.placement.id,transition:gap,constraints:placementConstraints(working,next.placement,now),fits:delta===0};
      if(delta!==0)block(next.placement.scope_id!==anchor.placement.scope_id?'GROUP_SCOPE_BOUNDARY':'GROUP_FIXED_BOUNDARY',[previous.placement,next.placement],{shortfall_minutes:Math.abs(delta)/minute});
      break;
    }
    if(delta!==0)move(next,next.start+delta,next.end-next.start);
    else {
      const changed=new Set(result.changes.map(c=>c.placement_id));
      const later=(working.time_links||[]).some(l=>live(l)&&(direction===1?changed.has(l.from_placement_id):changed.has(l.to_placement_id))&&(()=>{
        const a=working.placements.find(p=>p.id===l.from_placement_id),b=working.placements.find(p=>p.id===l.to_placement_id);
        return activePlacement(working,a)&&activePlacement(working,b)&&(!a.ends_at||!b.starts_at||Date.parse(b.starts_at)-Date.parse(a.ends_at)<l.minimum_minutes*minute);
      })());
      if(!later)break;
    }
    previous=next;
  }
  // Date-only entries cannot be assigned an order by sorting their IDs or inventing midnight.
  const changedTimes=result.changes.flatMap(c=>[c.before.starts_at,c.before.ends_at,c.after.starts_at,c.after.ends_at]).map(Date.parse);
  const low=Math.min(...changedTimes),high=Math.max(...changedTimes);
  for(const p of incomplete.filter(p=>!p.starts_at&&(p.date_start||p.date_end)))if(incompleteIntersects(p,low,high))block('GROUP_ORDER_INCOMPLETE',[p],{date_start:p.date_start,date_end:p.date_end});
  for(const g of resolveRoute(s).gaps)if(!g.date_start&&!g.date_end||incompleteIntersects(g,low,high))result.issues.push(routeIssue('GROUP_ROUTE_GAP',[{type:'decision',id:g.decision_id},{type:'gap',id:g.id}],{date_start:g.date_start,date_end:g.date_end},[],true));
  // Offer a recomputed boundary, never an automatically applied fallback.
  if(suggest&&boundaryIndex!==null&&result.issues.some(i=>['GROUP_FIXED_BOUNDARY','GROUP_SCOPE_BOUNDARY'].includes(i.code))){
    let edge=direction===1?nodes[boundaryIndex].start:nodes[boundaryIndex].end;
    let possible=true;
    for(let i=boundaryIndex-direction;direction===1?i>=index:i<=index;i-=direction){
      const a=direction===1?nodes[i]:nodes[i+direction],b=direction===1?nodes[i+direction]:nodes[i];
      const gap=transition(working,a.placement,b.placement,now);
      if(gap.required_minutes===null){possible=false;break;}
      const span=i===index?duration:nodes[i].end-nodes[i].start;
      edge+=direction===1?-(span+gap.required_minutes*minute):span+gap.required_minutes*minute;
    }
    const proposed=direction===1?edge:edge-duration;
    const original=Date.parse(s.placements.find(p=>p.id===pid).starts_at);
    if(possible&&(direction===1?proposed>=original:proposed<=original)){
      const retry=groupShift(s,pid,{...data,starts_at:new Date(proposed).toISOString()},now,{suggest:false});
      if(!retry.issues.length){
        const candidate=structuredClone(s),changed=new Set(retry.changes.map(c=>c.placement_id));
        for(const c of retry.changes)Object.assign(candidate.placements.find(p=>p.id===c.placement_id),c.after);
        const invalid=deriveSchedule(candidate,now).issues.some(i=>i.refs.some(r=>changed.has(r.id))&&(i.hard||['SCHEDULE_OVERLAP','TRANSITION_BUFFER_SHORT','TIME_INCOMPLETE','TIME_LINK_INCOMPLETE'].includes(i.code)||i.code==='LONG_TRANSFER_REVIEW'&&!i.values.resolved));
        if(!invalid)result.nearest_start=new Date(proposed).toISOString();
      }
    }
  }
  return result;
}
