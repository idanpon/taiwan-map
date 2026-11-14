import { live, activePlacement } from './planning-readiness.js';
import { boundServices, transition, canonical } from './planning-transitions.js';
import { dayInZone } from './planning-model.js';
import { localInstants, civilDayStart } from './trip-timezones.js';
import { resolveRoute } from './planning-scopes.js';

const minute=60000,at=value=>value?Date.parse(value):null;
export const exact=p=>p.precision==='exact'&&Number.isFinite(at(p.starts_at))&&Number.isFinite(at(p.ends_at))&&at(p.starts_at)<at(p.ends_at);
export function incompleteIntersects(p,start,end){
  const first=p.date_start||p.date_end,last=p.date_end||p.date_start;if(!first||!last)return false;
  const next=new Date(Date.parse(last)+86400000).toISOString().slice(0,10),zone=p.start_timezone||p.end_timezone;
  // Without a timezone, retain a conservative range instead of assigning local midnight.
  const from=zone?civilDayStart(first,zone):Date.parse(first)-14*3600000,to=zone?civilDayStart(next,zone):Date.parse(next)+14*3600000;
  return from<end&&to>start;
}
const byTime=(a,b)=>a.start-b.start||(a.id<b.id?-1:a.id>b.id?1:0);
export function scheduleNodes(s){
  const nodes=[],incomplete=[];
  for(const p of s.placements.filter(p=>activePlacement(s,p))){
    const item=s.items.find(i=>i.id===p.item_id);
    if(item.kind==='stay'){
      for(const [key,side] of [['starts_at','check_in'],['ends_at','check_out']])if(p[key])nodes.push({id:p.id+':'+side,placement:p,start:at(p[key]),end:at(p[key]),kind:'stay',side,complete:true});
      continue;
    }
    const node={id:p.id,placement:p,start:at(p.starts_at),end:at(p.ends_at),kind:item.kind,side:null,complete:exact(p)};
    if(node.start!==null)nodes.push(node);
    if(!node.complete)incomplete.push(p);
  }
  return {nodes:nodes.sort(byTime),incomplete};
}
export function placementConstraints(s,p,now){
  const result=[];
  function add(type,id,version,kind,v,extra={}){
    const c={id:type+':'+id+':'+kind,placement_id:p.id,type,source_id:id,version,kind,start_min:null,start_max:null,end_min:null,end_max:null,min_duration:null,max_duration:null,...extra};
    if(kind==='fixed_start')c.start_min=c.start_max=at(v.at);
    if(kind==='fixed_interval'){c.start_min=c.start_max=at(v.start);c.end_min=c.end_max=at(v.end);}
    if(kind==='window'){c.start_min=at(v.start);c.end_max=at(v.end);}
    if(kind==='date_range')Object.assign(c,{date_start:v.date_start||v.date_end,date_end:v.date_end||v.date_start,timezone:v.timezone,stay:v.stay||s.items.some(i=>i.id===p.item_id&&i.kind==='stay')});
    if(kind==='min_duration')c.min_duration=v.minutes;
    if(kind==='max_duration')c.max_duration=v.minutes;
    if(['check_in_earliest','check_in_latest','check_out_latest'].includes(kind)){
      const base=kind==='check_out_latest'?v.date_end:v.date_start;
      const day=base?new Date(Date.parse(base)+v.day_offset*86400000).toISOString().slice(0,10):null;
      const matches=day?localInstants(day,v.local_time,v.timezone):[];
      if(matches.length!==1)c.unknown=true;
      else c[kind==='check_in_earliest'?'start_min':kind==='check_in_latest'?'start_max':'end_max']=matches[0];
    }
    result.push(c);
  }
  for(const c of (s.constraints||[]).filter(c=>live(c)&&c.placement_id===p.id))add('constraint',c.id,c.version,c.kind,JSON.parse(c.values_json),{reason:c.reason});
  const services=boundServices(s,p,now),stays=services.filter(v=>v.kind==='stay'&&v.validity==='date_range');
  const stayStart=stays.map(v=>v.date_start).sort()[0],stayEnd=stays.map(v=>v.date_end).sort().at(-1);
  for(const v of services){
    const terms=JSON.parse(v.terms_json),extra={state:v.state};
    if(v.validity==='exact_start')add('service',v.id,v.version,'fixed_start',{at:v.starts_at},extra);
    if(v.validity==='exact_interval')add('service',v.id,v.version,'fixed_interval',{start:v.starts_at,end:v.ends_at},extra);
    if(v.validity==='open_window')add('service',v.id,v.version,'window',{start:v.starts_at,end:v.ends_at},extra);
    if(v.validity==='date_range'){
      // Split nights at one location constrain the combined stay, not an intersection of disjoint nights.
      const start=v.kind==='stay'?stayStart:v.date_start,end=v.kind==='stay'?stayEnd:v.date_end;
      add('service',v.id,v.version,'date_range',{date_start:start,date_end:end,timezone:v.start_timezone,stay:v.kind==='stay'},extra);
    }
    for(const kind of ['min_duration','max_duration'])if(terms[kind+'_minutes']!=null)add('service',v.id,v.version,kind,{minutes:terms[kind+'_minutes']},extra);
    // Consecutive nights of one stay have one arrival and one departure; interior split edges are not new check-ins.
    for(const kind of ['check_in_earliest','check_in_latest','check_out_latest'])if(terms[kind]&&(kind==='check_out_latest'?v.date_end===stayEnd:v.date_start===stayStart))add('service',v.id,v.version,kind,{...terms[kind],date_start:v.date_start,date_end:v.date_end},extra);
    if(v.validity==='unknown')add('service',v.id,v.version,'unknown',{},extra);
  }
  return result.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
export function approvalContext(s,p,now){
  return canonical({constraints:placementConstraints(s,p,now),services:boundServices(s,p,now).map(v=>({id:v.id,version:v.version,state:v.state})).sort((a,b)=>a.id<b.id?-1:1)});
}
export function immovable(s,node,now){
  const item=s.items.find(i=>i.id===node.placement.item_id);
  return !node.complete||node.kind==='stay'||['done','cancelled'].includes(item.state)||item.route_owner_decision_id||placementConstraints(s,node.placement,now).some(c=>!['min_duration','max_duration'].includes(c.kind));
}
export function scheduleIssue(code,placements,values={},sources=[],severity='warning',hard=false){
  const refs=placements.map(p=>({type:'placement',id:typeof p==='string'?p:p.id}));
  return {code,severity,hard,blocking:false,refs,values,sources,key:canonical({code,refs,values,sources})};
}
const source=c=>({type:c.type,id:c.source_id,version:c.version,rule:c.kind});
function constraintIssues(p,constraints){
  const issues=[],start=at(p.starts_at),end=at(p.ends_at),duration=start!==null&&end!==null?(end-start)/minute:p.intended_duration_minutes;
  for(const c of constraints){
    if(['check_in_earliest','check_in_latest'].includes(c.kind)&&start===null||c.kind==='check_out_latest'&&end===null)continue;
    let mismatch=false,unknown=Boolean(c.unknown),difference=0;
    for(const [value,min,max] of [[start,c.start_min,c.start_max],[end,c.end_min,c.end_max],[duration,c.min_duration,c.max_duration]]){
      if(min===null&&max===null)continue;
      if(value===null){unknown=true;continue;}
      const delta=Math.max(0,min===null?0:min-value,max===null?0:value-max);if(delta>0){mismatch=true;difference+=delta;}
    }
    if(c.kind==='date_range'){
      const a=p.starts_at?dayInZone(p.starts_at,c.timezone||p.start_timezone):p.date_start,b=p.ends_at?dayInZone(p.ends_at,c.timezone||p.end_timezone):p.date_end||a;
      if(!a||!b)unknown=true;
      else if(c.stay?a!==c.date_start||b!==c.date_end:a<c.date_start||b>c.date_end){mismatch=true;difference=1;}
    }
    if(c.kind==='unknown')unknown=true;
    if(mismatch)issues.push(scheduleIssue(c.kind==='window'?'WINDOW_VIOLATION':['min_duration','max_duration'].includes(c.kind)?'DURATION_VIOLATION':'PIN_MISMATCH',[p],{starts_at:p.starts_at,ends_at:p.ends_at,date_start:p.date_start,date_end:p.date_end,difference,constraint:c},[source(c)],'error',true));
    else if(unknown)issues.push(scheduleIssue('TIME_CONSTRAINT_UNKNOWN',[p],{constraint_id:c.id},[source(c)]));
  }
  return issues;
}
function ownLimit(p,constraints){
  const start=at(p.starts_at),bounds=[];
  for(const c of constraints){if(c.max_duration!==null)bounds.push({minutes:c.max_duration,source:source(c)});if(c.end_max!==null)bounds.push({minutes:(c.end_max-start)/minute,source:source(c)});}
  return bounds;
}
export function durationLimits(s,nodes,index,now,constraints){
  const node=nodes[index],p=node.placement;
  if(!node.complete||node.kind==='stay')return null;
  const own=ownLimit(p,constraints),direct=[...own],group=[...own];
  let unknown=constraints.some(c=>c.unknown||c.kind==='unknown'),groupUnknown=unknown||nodes.some(n=>n.id!==node.id&&n.start===node.start),boundary=null;
  const links=(s.time_links||[]).filter(l=>live(l)&&activePlacement(s,s.placements.find(p=>p.id===l.from_placement_id))&&activePlacement(s,s.placements.find(p=>p.id===l.to_placement_id)));
  for(const link of links.filter(l=>l.from_placement_id===p.id)){
    const q=s.placements.find(q=>q.id===link.to_placement_id);
    if(!q.starts_at){unknown=true;groupUnknown=true;}
    else direct.push({minutes:(at(q.starts_at)-node.start)/minute-link.minimum_minutes,source:{type:'time_link',id:link.id,version:link.version}});
  }
  const next=nodes[index+1];
  if(next){
    const gap=transition(s,p,next.placement,now);
    if(gap.required_minutes===null||!next.complete)unknown=true;
    else direct.push({minutes:(next.start-node.start)/minute-gap.required_minutes,source:{type:'placement',id:next.placement.id,version:next.placement.version},transition:gap});
  }
  for(let i=index+1;i<nodes.length;i++){
    if(nodes[i].start===nodes[i-1].start){groupUnknown=true;break;}
    const gap=transition(s,nodes[i-1].placement,nodes[i].placement,now);
    if(gap.required_minutes===null||!nodes[i].complete){groupUnknown=true;break;}
    if(nodes[i].placement.scope_id!==p.scope_id||immovable(s,nodes[i],now)){boundary=i;break;}
  }
  if(boundary!==null){
    const latest=new Map([[nodes[boundary].placement.id,nodes[boundary].start]]),provenance=[];
    for(let i=boundary-1;i>=index;i--){
      const current=nodes[i],following=nodes[i+1],gap=transition(s,current.placement,following.placement,now);
      let end=latest.get(following.placement.id)-gap.required_minutes*minute;
      provenance.push({type:'transition',from:current.placement.id,to:following.placement.id,required_minutes:gap.required_minutes,approximate:gap.approximate,sources:gap.sources});
      for(const link of links.filter(l=>l.from_placement_id===current.placement.id)){
        const target=nodes.find(n=>n.placement.id===link.to_placement_id),targetTime=latest.get(link.to_placement_id)??target?.start;
        if(targetTime===undefined){groupUnknown=true;continue;}
        end=Math.min(end,targetTime-link.minimum_minutes*minute);provenance.push({type:'time_link',id:link.id,version:link.version,minutes:link.minimum_minutes});
      }
      if(i===index)group.push({minutes:(end-node.start)/minute,source:{type:'placement',id:nodes[boundary].placement.id,version:nodes[boundary].placement.version},path:provenance});
      else latest.set(current.placement.id,end-(current.end-current.start));
    }
  }
  const pending=scheduleNodes(s).incomplete.filter(x=>!x.starts_at&&(x.date_start||x.date_end));
  if(pending.some(x=>incompleteIntersects(x,node.start,next?.start||node.end)))unknown=true;
  if(pending.some(x=>incompleteIntersects(x,node.start,boundary===null?nodes.at(-1)?.end||node.end:nodes[boundary].start)))groupUnknown=true;
  for(const gap of resolveRoute(s).gaps){
    if(!gap.date_start&&!gap.date_end||incompleteIntersects(gap,node.start,next?.start||node.end))unknown=true;
    if(!gap.date_start&&!gap.date_end||incompleteIntersects(gap,node.start,boundary===null?nodes.at(-1)?.end||node.end:nodes[boundary].start))groupUnknown=true;
  }
  const conflict=constraintIssues(p,constraints).some(i=>i.hard);
  const format=(bounds,uncertain)=>{
    const value=bounds.length?Math.min(...bounds.map(b=>b.minutes)):null,current=(node.end-node.start)/minute;
    return {status:conflict?'conflict':uncertain?'unknown':value===null?'no_known_limit':value<current?'conflict':'bounded',approximate:bounds.some(b=>b.transition?.approximate||b.path?.some(t=>t.approximate)),max_minutes:uncertain?null:value===null?null:Math.max(0,value),
      known_upper_bound_minutes:value===null?null:Math.max(0,value),additional_minutes:uncertain||value===null?null:Math.max(0,value-current),sources:bounds};
  };
  return {placement_id:p.id,without_shift:format(direct,unknown),with_shift:format(group,groupUnknown)};
}
export function deriveSchedule(s,now){
  const {nodes,incomplete}=scheduleNodes(s),issues=[],transitions=[],constraints=[],placements=[];
  const route=resolveRoute(s);
  for(const p of s.placements.filter(p=>activePlacement(s,p))){
    const reasons=placementConstraints(s,p,now),own=constraintIssues(p,reasons);constraints.push(...reasons);issues.push(...own);
    const item=s.items.find(i=>i.id===p.item_id);
    const complete=item.kind==='stay'?Boolean(p.date_start&&p.date_end):exact(p);
    if(!complete)issues.push(scheduleIssue('TIME_INCOMPLETE',[p],{precision:p.precision}));
    placements.push({id:p.id,commitment:p.commitment,complete,requires_review:p.commitment==='approved'&&(p.approved_context_json!==approvalContext(s,p,now)||own.some(i=>i.hard||i.code==='TIME_CONSTRAINT_UNKNOWN')),constraint_ids:reasons.map(c=>c.id)});
  }
  // Every interval, not just adjacent rows. Stay occupies only its explicit arrival/departure points.
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
    const a=nodes[i],b=nodes[j];if(a.placement.id===b.placement.id||!a.complete||!b.complete)continue;
    if(b.start>=a.end)break;
    const overlap=a.start<b.end&&b.start<a.end||b.kind==='stay'&&b.start>a.start&&b.start<a.end;
    if(overlap)issues.push(scheduleIssue('SCHEDULE_OVERLAP',[a.placement,b.placement],{overlap_minutes:(Math.min(a.end,b.end)-Math.max(a.start,b.start))/minute},[],a.placement.commitment==='approved'&&b.placement.commitment==='approved'?'error':'warning',a.placement.commitment==='approved'&&b.placement.commitment==='approved'));
  }
  for(let i=1;i<nodes.length;i++){
    const a=nodes[i-1],b=nodes[i];if(a.placement.id===b.placement.id)continue;
    const gap=transition(s,a.placement,b.placement,now),available=a.end===null?null:(b.start-a.end)/minute;
    const t={...gap,from_node_id:a.id,to_node_id:b.id,available_minutes:available,shortfall_minutes:gap.required_minutes===null||available===null?null:Math.max(0,gap.required_minutes-available)};transitions.push(t);
    const refs=[a.placement,b.placement];
    if(gap.approximate)issues.push(scheduleIssue('TRANSITION_ESTIMATE',refs,{distance_m:gap.distance_m,movement_minutes:gap.movement_minutes,route_check_required:true},gap.sources,'info'));
    if(gap.status==='override_conflict')issues.push(scheduleIssue('TRANSITION_OVERRIDE_CONFLICT',refs,{},gap.sources,'error',true));
    if(gap.distance_m===null)issues.push(scheduleIssue('DISTANCE_UNKNOWN_DEFAULT',refs,{fallback_minutes:15,used_minutes:gap.movement_minutes},gap.sources,'info'));
    if(gap.status==='unresolved_long_transfer')issues.push(scheduleIssue('LONG_TRANSFER_REVIEW',refs,{distance_m:gap.distance_m,range:gap.range,resolved:gap.required_minutes!==null},gap.sources));
    if(gap.candidates||gap.incomplete_points)issues.push(scheduleIssue('DISTANCE_INCOMPLETE',refs,{candidates:gap.candidates,missing_points:gap.incomplete_points},gap.sources,'info'));
    if(gap.stale_override_ids.length)issues.push(scheduleIssue('TRANSITION_OVERRIDE_STALE',refs,{override_ids:gap.stale_override_ids},gap.sources));
    if(available!==null&&gap.required_minutes!==null&&available<gap.required_minutes){
      const mandatory=gap.mandatory_minutes>0&&available<gap.mandatory_minutes,selected=['manual','accepted'].includes(gap.mode),approved=a.placement.commitment==='approved'&&b.placement.commitment==='approved';
      issues.push(scheduleIssue(mandatory?'TRANSITION_CONDITION_SHORT':'TRANSITION_BUFFER_SHORT',refs,{available_minutes:available,required_minutes:gap.required_minutes,shortfall_minutes:gap.required_minutes-available,approximate:gap.approximate},gap.sources,mandatory||selected&&approved?'error':'warning',mandatory||selected&&approved));
    }
  }
  for(const link of (s.time_links||[]).filter(live)){
    const a=s.placements.find(p=>p.id===link.from_placement_id),b=s.placements.find(p=>p.id===link.to_placement_id);if(!activePlacement(s,a)||!activePlacement(s,b))continue;
    if(!a.ends_at||!b.starts_at){issues.push(scheduleIssue('TIME_LINK_INCOMPLETE',[a,b],{},[{type:'time_link',id:link.id,version:link.version}]));continue;}
    const available=(at(b.starts_at)-at(a.ends_at))/minute;
    if(available<link.minimum_minutes)issues.push(scheduleIssue('TIME_LINK_VIOLATION',[a,b],{available_minutes:available,required_minutes:link.minimum_minutes,shortfall_minutes:link.minimum_minutes-available},[{type:'time_link',id:link.id,version:link.version}],'error',true));
  }
  const stays=s.placements.filter(p=>activePlacement(s,p)&&s.items.some(i=>i.id===p.item_id&&i.kind==='stay')&&p.date_start&&p.date_end);
  for(let i=0;i<stays.length;i++)for(let j=i+1;j<stays.length;j++)if(stays[i].date_start<stays[j].date_end&&stays[j].date_start<stays[i].date_end){const hard=stays[i].commitment==='approved'&&stays[j].commitment==='approved';issues.push(scheduleIssue('STAY_NIGHT_OVERLAP',[stays[i],stays[j]],{},[],hard?'error':'warning',hard));}
  for(const p of placements)if(p.commitment==='approved'&&issues.some(i=>i.hard&&i.refs.some(r=>r.id===p.id)))p.requires_review=true;
  return {status:issues.some(i=>i.hard)?'conflict':route.gaps.length||incomplete.length||issues.some(i=>['TIME_CONSTRAINT_UNKNOWN','TIME_LINK_INCOMPLETE'].includes(i.code)||i.code==='LONG_TRANSFER_REVIEW'&&!i.values.resolved)?'incomplete':issues.some(i=>i.severity==='warning')||transitions.some(t=>t.approximate)?'warnings':'checked',road_routes_calculated:false,placements,constraints,transitions,issues,
    duration_limits:nodes.map((n,i)=>durationLimits(s,nodes,i,now,constraints.filter(c=>c.placement_id===n.placement.id))).filter(Boolean)};
}
