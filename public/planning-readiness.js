// Deterministic projection of explicit links. No network, AI, persistence or implicit clock.
import { dayInZone } from './planning-model.js';
import { scopeActive, decisionSatisfied } from './planning-scopes.js';

export const live = row => row && row.archived_at == null;
const rows = (s, key) => (s[key] || []).filter(live);
const terms = service => JSON.parse(service.terms_json);
const endStates = ['cancelled', 'expired', 'superseded'];
export function nights(start, end) {
  if (!start || !end || start >= end) return [];
  const count = (Date.parse(end)-Date.parse(start))/86400000;
  if (!Number.isInteger(count) || count > 3660) return [];
  return Array.from({length:count}, (_,i)=>new Date(Date.parse(start)+i*86400000).toISOString().slice(0,10));
}
export function activePlacement(s, p) {
  const item=s.items.find(i=>i.id===p?.item_id), scope=s.scopes.find(x=>x.id===p?.scope_id);
  return live(p)&&live(item)&&item.state!=='cancelled'&&p.participation==='included'&&live(scope)&&scopeActive(s,scope.id);
}
export function activeNeedTargets(s, need) {
  return scopeActive(s,need.scope_id)?rows(s,'need_targets').filter(t=>t.need_id===need.id).map(t=>s.placements.find(p=>p.id===t.placement_id)).filter(p=>activePlacement(s,p)):[];
}
export function taskApplicable(s, task) {
  if (!live(task)) return false;
  // Work to reconcile an actual purchase survives route/need deactivation.
  if (rows(s,'service_tasks').some(l=>l.task_id===task.id&&live(s.services.find(x=>x.id===l.service_id)))) return true;
  const scope=s.scopes.find(x=>x.id===task.activation_scope_id);
  if (!live(scope)||!scopeActive(s,scope.id)) return false;
  if (task.task_activation!=='linked_needs') return true;
  return rows(s,'need_tasks').some(l=>l.task_id===task.id&&rows(s,'needs').some(n=>n.id===l.need_id&&n.lifecycle==='active'&&activeNeedTargets(s,n).length));
}
export function serviceState(service, now) {
  return service.state==='held'&&service.hold_expires_at!==null&&service.hold_expires_at<=now?'expired':service.state;
}
const rolesFor = kind => kind==='stay'?['lodging']:kind==='transport'?['departure','arrival']:['visit'];
function places(s, collection, ownerKey, id, role) {
  return rows(s,collection).filter(l=>l[ownerKey]===id&&l.role===role&&(collection!=='placement_places'||l.selection==='chosen'));
}
// Canonical context, stored in the historical *_hash column. Not a security digest.
// Labels alone never establish equivalence; any endpoint change invalidates verification.
export function placeMatchContext(s, needId, serviceId) {
  const compare=(a,b)=>a<b?-1:a>b?1:0;
  const project=l=>[l.role,l.place_id,l.label_snapshot,Boolean(l.place_id&&s.places.some(p=>p.id===l.place_id))];
  const ordered=list=>list.map(project).sort((a,b)=>compare(JSON.stringify(a),JSON.stringify(b)));
  return JSON.stringify({service:serviceId,places:ordered(rows(s,'service_places').filter(l=>l.service_id===serviceId&&l.role!=='reference')),
    targets:rows(s,'need_targets').filter(t=>t.need_id===needId).map(t=>[t.placement_id,ordered(rows(s,'placement_places').filter(l=>l.placement_id===t.placement_id&&l.role!=='reference'&&l.selection==='chosen'))]).sort((a,b)=>compare(a[0],b[0]))});
}
function matchPlace(s, p, service, link) {
  let unknown=false,unverifiable=false;
  for (const role of rolesFor(service.kind)) {
    const a=places(s,'placement_places','placement_id',p.id,role),b=places(s,'service_places','service_id',service.id,role);
    if(!a.length||!b.length)unverifiable=true;
    const known=list=>list.filter(l=>l.place_id&&s.places.some(p=>p.id===l.place_id)).map(l=>l.place_id);
    const ai=known(a),bi=known(b);
    if(ai.length&&bi.length){if(!ai.some(id=>bi.includes(id)))return 'mismatch';}
    else unknown=true;
  }
  if(unknown&&!unverifiable&&link.place_match_override==='verified'&&link.place_match_context_hash===placeMatchContext(s,link.need_id,service.id))return 'match';
  return unknown?'unknown':'match';
}
function matchTime(p, service, night) {
  if(service.validity==='unknown')return 'unknown';
  if(service.kind==='stay')return night&&service.date_start&&service.date_end?(night>=service.date_start&&night<service.date_end?(p.start_timezone===service.start_timezone?'match':'unknown'):'mismatch'):'unknown';
  if(service.validity==='date_range'){
    if(!p.starts_at&&p.start_timezone!==service.start_timezone)return 'unknown';
    const date=p.starts_at&&service.start_timezone?dayInZone(p.starts_at,service.start_timezone):p.date_start;
    return date?(date>=service.date_start&&date<=service.date_end?'match':'mismatch'):'unknown';
  }
  if(!p.starts_at)return 'unknown';
  if(service.validity==='exact_start'&&Date.parse(p.starts_at)!==Date.parse(service.starts_at))return 'mismatch';
  if(service.validity==='exact_interval'){
    if(!p.ends_at)return 'unknown';
    if(Date.parse(p.starts_at)!==Date.parse(service.starts_at)||Date.parse(p.ends_at)!==Date.parse(service.ends_at))return 'mismatch';
  }
  if(service.validity==='open_window'){
    if(!p.ends_at)return 'unknown';
    if(Date.parse(p.starts_at)<Date.parse(service.starts_at)||Date.parse(p.ends_at)>Date.parse(service.ends_at))return 'mismatch';
  }
  const t=terms(service),duration=p.ends_at?(Date.parse(p.ends_at)-Date.parse(p.starts_at))/60000:p.intended_duration_minutes;
  if(t.min_duration_minutes!=null||t.max_duration_minutes!=null){
    if(duration==null)return 'unknown';
    if((t.min_duration_minutes!=null&&duration<t.min_duration_minutes)||(t.max_duration_minutes!=null&&duration>t.max_duration_minutes))return 'mismatch';
  }
  return 'match';
}
const occurrence = (s,p,service,night) => service.kind==='stay'?night||'unknown':JSON.stringify([p.starts_at||p.date_start||p.id,p.ends_at||p.date_end,
  rolesFor(service.kind).map(role=>places(s,'placement_places','placement_id',p.id,role).map(l=>l.place_id||l.id).sort())]);
function candidate(s,need,p,link,service,night,now) {
  const state=serviceState(service,now), item=s.items.find(i=>i.id===p.item_id);
  const kind={admission:'admission',accommodation:'stay',transport:'transport'}[need.kind],criteria=JSON.parse(need.criteria_json);
  const stateMatch=state==='confirmed'||(state==='used'&&item.state==='done'&&item.completed_at!=null&&item.completed_at<=now);
  const q=link.allocated_units??(need.required_units!=null&&service.capacity_units!=null?Math.min(need.required_units,service.capacity_units):need.required_units);
  return {need_id:need.id,placement_id:p.id,service_id:service.id,link_id:link.id,night,occurrence:occurrence(s,p,service,night),units:q,
    kind:service.kind===kind&&(!criteria.allowed_service_kinds?.length||criteria.allowed_service_kinds.includes(service.kind))?'match':'mismatch',
    state:stateMatch?'match':state==='held'||state==='pending'?'unknown':'mismatch',
    time:matchTime(p,service,night),place:matchPlace(s,p,service,link),
    quantity:need.unit_type==='unspecified'||service.unit_type==='unspecified'||q==null||service.capacity_units==null||need.required_units==null?'unknown':need.unit_type===service.unit_type?'match':'mismatch'};
}

export function derivePreparation(s, now) {
  const issues=[],needs=[],candidates=[],coverage=[],services=[],tasks=[],timeReasons=[];
  const issue=(code,refs,severity='warning')=>issues.push({code,severity,refs});
  // Build all demands before resolving capacity, so separate needs cannot spend one ticket twice.
  for(const need of rows(s,'needs')){
    const targets=activeNeedTargets(s,need),projection={id:need.id,applicability:targets.length?'active':'dormant',status:need.lifecycle==='active'?'missing':need.lifecycle,targets:[]};
    needs.push(projection);
    if(!targets.length||need.lifecycle!=='active')continue;
    for(const p of targets){
      const target={placement_id:p.id,status:'missing',units:[]};projection.targets.push(target);
      if(need.kind==='decision_result'){
        const results=rows(s,'need_decision_results').filter(l=>l.need_id===need.id);
        target.status=results.length&&results.every(l=>decisionSatisfied(s,l.decision_id,l.required_option_id))?'satisfied':'missing';continue;
      }
      if(need.kind==='task_result'){
        const results=rows(s,'need_task_results').filter(l=>l.need_id===need.id).map(l=>s.items.find(t=>t.id===l.task_id));
        target.status=results.length&&results.every(t=>live(t)&&t.state==='done')?'satisfied':'missing';continue;
      }
      const days=need.kind==='accommodation'?nights(p.date_start,p.date_end):[null];
      if(!days.length){target.status='unknown';continue;}
      for(const night of days){
        const exempt=night&&rows(s,'need_exemptions').some(e=>e.need_id===need.id&&e.placement_id===p.id&&night>=e.date_start&&night<e.date_end);
        const unit={night,status:exempt?'waived':'missing',candidates:[]};target.units.push(unit);
        if(exempt)continue;
        for(const link of rows(s,'need_services').filter(l=>l.need_id===need.id)){
          const service=rows(s,'services').find(x=>x.id===link.service_id);if(!service)continue;
          const c=candidate(s,need,p,link,service,night,now);candidates.push(c);unit.candidates.push(c);
        }
      }
    }
  }
  for(const service of rows(s,'services')){
    const t=terms(service),state=serviceState(service,now);
    const uses=candidates.filter(c=>c.service_id===service.id&&c.kind==='match'&&c.time!=='mismatch'&&c.place!=='mismatch'&&c.state!=='mismatch');
    const unique=new Map();
    for(const c of uses)unique.set(c.need_id+':'+c.occurrence,c);
    const allUses=[...unique.values()],distinct=[...new Set(allUses.map(c=>c.occurrence))];
    // Rooms can be used again on a different night. Reusable passes need explicit sharing.
    const shared=t.usage==='reusable'&&allUses.every(c=>s.need_services.find(l=>l.id===c.link_id).use_mode==='shared');
    const buckets=new Map();
    for(const c of allUses){const key=service.kind==='stay'||shared?c.occurrence:'single';if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(c);}
    for(const bucket of buckets.values()){
      const over=service.capacity_units!==null&&bucket.reduce((a,c)=>a+(c.units||0),0)>service.capacity_units;
      const uncertain=service.capacity_units==null||bucket.some(c=>c.units==null||c.quantity==='unknown');
      const affected=new Set(bucket.map(c=>c.need_id+':'+c.occurrence));
      for(const c of uses.filter(c=>affected.has(c.need_id+':'+c.occurrence))){if(over)c.quantity='mismatch';else if(uncertain&&c.quantity!=='mismatch')c.quantity='unknown';}
      if(over)issue('SERVICE_OVERALLOCATED',{service_id:service.id,need_ids:[...new Set(bucket.map(c=>c.need_id))]});
    }
    if(shared&&distinct.length>1&&(t.allowed_uses==null||distinct.length>t.allowed_uses)){
      for(const c of uses)c.quantity=t.allowed_uses==null?'unknown':'mismatch';
      issue(t.allowed_uses==null?'SERVICE_USE_LIMIT_UNKNOWN':'SERVICE_USE_LIMIT_EXCEEDED',{service_id:service.id});
    }
    const compatible=uses.filter(c=>c.state==='match'&&c.time==='match'&&c.place==='match'&&c.quantity!=='mismatch');
    const usedNights=[...new Set(compatible.map(c=>c.night).filter(Boolean))].sort();
    const allNights=service.kind==='stay'?nights(service.date_start,service.date_end):[];
    const unused=allNights.filter(n=>!usedNights.includes(n));
    const links=rows(s,'need_services').filter(l=>l.service_id===service.id);
    const taskIds=rows(s,'service_tasks').filter(l=>l.service_id===service.id).map(l=>l.task_id);
    const unusedUnits=service.capacity_units==null||allUses.some(c=>c.units==null||c.quantity==='unknown')?null:Math.max(0,service.capacity_units-Math.max(0,...[...buckets.values()].map(bucket=>bucket.reduce((sum,c)=>sum+c.units,0))));
    services.push({id:service.id,booking_id:service.booking_id,effective_state:state,need_ids:links.map(l=>l.need_id),
      placement_ids:[...new Set(compatible.map(c=>c.placement_id))],task_ids:taskIds,used_nights:usedNights,unused_nights:unused,
      unused_units:unusedUnits,
      needs_action:['held','confirmed'].includes(state)&&(compatible.length===0||unused.length>0||unusedUnits>0),
      deadlines:rows(s,'deadlines').filter(d=>d.service_id===service.id).map(d=>({...d,applicable:!endStates.includes(state)&&state!=='used'}))});
    if(['held','confirmed'].includes(state)&&!compatible.length)issue('SERVICE_NOT_USED_BY_PLAN',{service_id:service.id});
    if(state==='held'&&service.hold_expires_at==null)issue('HOLD_EXPIRY_UNKNOWN',{service_id:service.id});
    if(['confirmed','held'].includes(state))for(const c of candidates.filter(c=>c.service_id===service.id)){
      if(timeReasons.some(r=>r.service_id===service.id&&r.placement_id===c.placement_id))continue;
      if(service.validity!=='unknown')timeReasons.push({id:'service:'+service.id+':'+c.placement_id,service_id:service.id,source_version:service.version,placement_id:c.placement_id,
        validity:service.validity,starts_at:service.starts_at,ends_at:service.ends_at,date_start:service.date_start,date_end:service.date_end,
        arrival_lead_minutes:service.arrival_lead_minutes,exit_allowance_minutes:service.exit_allowance_minutes,terms:t,state,expires_at:state==='held'?service.hold_expires_at:null});
    }
  }
  const aggregate=statuses=>statuses.every(x=>['satisfied','waived'].includes(x))?'satisfied':statuses.some(x=>['satisfied','partial'].includes(x))?'partial':statuses.includes('unknown')?'unknown':statuses.includes('mismatch')?'mismatch':'missing';
  for(const n of needs){
    if(n.applicability!=='active'||n.status==='waived'||n.status==='retired'||!n.targets.length)continue;
    const need=s.needs.find(x=>x.id===n.id);
    for(const target of n.targets){
      for(const unit of target.units){
        if(unit.status==='waived')continue;
        const good=unit.candidates.filter(c=>[c.kind,c.state,c.time,c.place,c.quantity].every(x=>x==='match'));
        const uncertain=unit.candidates.some(c=>![c.kind,c.state,c.time,c.place,c.quantity].includes('mismatch')&&[c.state,c.time,c.place,c.quantity].includes('unknown'));
        const amount=good.reduce((sum,c)=>sum+c.units,0);
        unit.covered_units=amount;unit.required_units=need.required_units;
        unit.status=amount>0&&need.required_units!=null&&amount>=need.required_units?'satisfied':amount>0?'partial':uncertain?'unknown':unit.candidates.some(c=>c.state!=='mismatch')?'mismatch':'missing';
        // Housing marker represents a real confirmed place/night, not group quantity readiness.
        if(need.kind==='accommodation')for(const c of unit.candidates.filter(c=>c.kind==='match'&&c.state==='match'&&c.time==='match'&&c.place==='match'&&c.quantity!=='mismatch')){
          for(const location of places(s,'service_places','service_id',c.service_id,'lodging').filter(l=>l.place_id))coverage.push({placement_id:target.placement_id,need_id:need.id,service_id:c.service_id,place_id:location.place_id,night:unit.night,quantity_status:c.quantity});
        }
      }
      if(target.units.length)target.status=aggregate(target.units.map(u=>u.status));
      if(!['satisfied','waived'].includes(target.status))issue('NEED_'+target.status.toUpperCase(),{need_id:n.id,placement_id:target.placement_id});
    }
    n.status=aggregate(n.targets.map(t=>t.status));
  }
  for(const task of rows(s,'items').filter(i=>i.kind==='task')){
    const missing=rows(s,'task_prerequisites').filter(l=>l.task_id===task.id).filter(l=>!s.items.some(i=>i.id===l.required_task_id&&live(i)&&i.state==='done')).map(l=>l.required_task_id);
    const decisionMissing=rows(s,'decision_prerequisites').filter(l=>l.task_id===task.id&&!decisionSatisfied(s,l.decision_id,l.required_option_id));
    missing.push(...decisionMissing.map(l=>l.decision_id));
    tasks.push({id:task.id,state:task.state,applicable:taskApplicable(s,task),blocked_by:missing,blocked_by_decisions:decisionMissing.map(l=>({decision_id:l.decision_id,required_option_id:l.required_option_id})),
      need_ids:rows(s,'need_tasks').filter(l=>l.task_id===task.id).map(l=>l.need_id),service_ids:rows(s,'service_tasks').filter(l=>l.task_id===task.id).map(l=>l.service_id)});
    if(task.state==='done'&&missing.length)issue('COMPLETED_TASK_PREREQUISITE_CHANGED',{task_id:task.id,required_task_ids:missing});
    const target=rows(s,'deadlines').find(d=>d.task_id===task.id&&d.kind==='target');
    const serviceIds=new Set(rows(s,'service_tasks').filter(l=>l.task_id===task.id).map(l=>l.service_id));
    const taskNeeds=new Set(rows(s,'need_tasks').filter(l=>l.task_id===task.id&&l.relation==='produce').map(l=>l.need_id));
    for(const l of rows(s,'need_services'))if(taskNeeds.has(l.need_id))serviceIds.add(l.service_id);
    if(target&&(target.at||target.local_date))for(const deadline of rows(s,'deadlines').filter(d=>serviceIds.has(d.service_id)&&['sales_close','payment','cancel_by'].includes(d.kind))){
      const service=s.services.find(x=>x.id===deadline.service_id);
      if(!service||endStates.includes(serviceState(service,now))||service.state==='used')continue;
      const tooLate=target.at&&deadline.at?Date.parse(target.at)>Date.parse(deadline.at):(target.local_date||dayInZone(target.at,deadline.timezone))>(deadline.local_date||dayInZone(deadline.at,deadline.timezone));
      if(tooLate)issue('TARGET_AFTER_SUPPLIER_DEADLINE',{task_id:task.id,target_deadline_id:target.id,service_id:service.id,deadline_id:deadline.id});
    }
  }
  const placements=rows(s,'placements').filter(p=>activePlacement(s,p)).map(p=>{
    const related=needs.filter(n=>n.applicability==='active'&&rows(s,'need_targets').some(t=>t.need_id===n.id&&t.placement_id===p.id));
    const statuses=related.filter(n=>!['waived','retired'].includes(n.status)).map(n=>n.targets.find(t=>t.placement_id===p.id)?.status||n.status);
    return {id:p.id,item_id:p.item_id,need_ids:related.map(n=>n.id),readiness:!statuses.length?'not_required':statuses.every(x=>['satisfied','waived'].includes(x))?'ready':statuses.some(x=>['unknown','mismatch'].includes(x))?'needs_review':'needs_preparation'};
  });
  const bookings=rows(s,'bookings').map(b=>{
    const parts=services.filter(s=>s.booking_id===b.id),states=[...new Set(parts.map(s=>s.effective_state))];
    return {id:b.id,state:states.length===1?states[0]:states.length?'mixed':'empty',service_ids:parts.map(s=>s.id),needs_action:parts.some(s=>s.needs_action)};
  });
  const expiries=rows(s,'services').filter(s=>s.state==='held'&&s.hold_expires_at>now).map(s=>s.hold_expires_at);
  return {completeness:{readiness:'supported',schedule:'unsupported',route_options:'unsupported'},needs,placements,tasks,services,bookings,housing_coverage:coverage,time_reasons:timeReasons,issues,
    next_evaluation_at:expiries.length?Math.min(...expiries):null};
}
