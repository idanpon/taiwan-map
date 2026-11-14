import { live, activePlacement, taskApplicable, derivePreparation, serviceState } from './planning-readiness.js';
import { resolveRoute, routeIssue } from './planning-scopes.js';
import { boundServices, canonical } from './planning-transitions.js';

const ref=(type,id)=>({type,id});
export function routeImpact(before,s,now){
  const a=derivePreparation(before,now),b=derivePreparation(s,now),items=[],preparation=[],bookings=[];
  const places=(data,id)=>data.placement_places.filter(l=>live(l)&&l.placement_id===id).map(l=>[l.role,l.selection,l.place_id,l.label_snapshot]).sort();
  for(const item of s.items.filter(i=>['visit','stay','transport'].includes(i.kind))){
    const old=before.placements.find(p=>p.item_id===item.id&&activePlacement(before,p)),next=s.placements.find(p=>p.item_id===item.id&&activePlacement(s,p));
    const slot=p=>p?{starts_at:p.starts_at,ends_at:p.ends_at,date_start:p.date_start,date_end:p.date_end,precision:p.precision}:null;
    if(!old&&!next)continue;
    const changed=canonical(slot(old))!==canonical(slot(next))||canonical(places(before,old?.id))!==canonical(places(s,next?.id));
    if(!changed&&old?.id===next?.id)continue;
    items.push({item_id:item.id,before_placement_id:old?.id??null,after_placement_id:next?.id??null,change:!old?'included':!next?'excluded':changed?'changed':'alternative',before:slot(old),after:slot(next)});
  }
  for(const item of s.items.filter(i=>i.kind==='task')){
    const old=before.items.find(t=>t.id===item.id),was=Boolean(taskApplicable(before,old)),is=Boolean(taskApplicable(s,item));
    if(was!==is)preparation.push({task_id:item.id,state:item.state,before_applicable:was,after_applicable:is});
  }
  for(const service of s.services.filter(v=>live(v)&&['confirmed','held'].includes(serviceState(v,now)))){
    const old=a.services.find(v=>v.id===service.id),next=b.services.find(v=>v.id===service.id);if(!old||!next)continue;
    const bound=data=>data.placements.filter(p=>activePlacement(data,p)&&boundServices(data,p,now).some(v=>v.id===service.id)).map(p=>p.item_id).sort();
    const oldBound=bound(before),newBound=bound(s),lost=old.used_nights.filter(n=>!next.used_nights.includes(n));
    const intended=projection=>projection.needs.flatMap(n=>n.targets.flatMap(t=>t.units.flatMap(u=>u.candidates||[]))).filter(c=>c.service_id===service.id&&c.kind==='match'&&c.time==='match'&&c.place==='match'&&c.quantity!=='mismatch');
    const oldIntent=intended(a),newIntent=intended(b),reservedLost=serviceState(service,now)==='held'?[...new Set(oldIntent.map(c=>c.night).filter(n=>n&&!newIntent.some(c=>c.night===n)))]:[];
    const becameUnused=old.placement_ids.length>0&&!next.placement_ids.length,unitsIncreased=old.unused_units!==null&&next.unused_units!==null&&next.unused_units>old.unused_units;
    if(!lost.length&&!reservedLost.length&&!(oldIntent.length&&!newIntent.length)&&!becameUnused&&!unitsIncreased&&!oldBound.some(id=>!newBound.includes(id)))continue;
    bookings.push({service_id:service.id,booking_id:service.booking_id,source_version:service.version,state:serviceState(service,now),before_item_ids:oldBound,after_item_ids:newBound,
      lost_nights:lost,lost_reserved_nights:reservedLost,used_nights:next.used_nights,unused_nights:next.unused_nights,unused_units:next.unused_units,needs_action:next.needs_action,
      deadlines:next.deadlines.map(d=>({id:d.id,version:d.version,kind:d.kind,at:d.at,local_date:d.local_date,timezone:d.timezone,applicable:d.applicable})),actions:['review','exchange','cancel']});
  }
  return {items,preparation,bookings};
}
export function routeOutcome(before,s,state,outcome,now){
  const route=resolveRoute(s),impact=routeImpact(before,s,now),issues=[...outcome.issues,...route.issues],allowed=new Set(outcome.allowed_acknowledgements);
  for(const issue of route.issues){
    const decisions=issue.refs.filter(r=>r.type==='option').map(r=>s.options.find(o=>o.id===r.id)?.item_id);
    if(decisions.some(id=>state.accepted.has(id)))issue.blocking=true;
  }
  if(state.choiceChanged.size){
    // A switch between identical placements does not release the supplier fact.
    for(let i=issues.length-1;i>=0;i--)if(issues[i].code==='BOOKING_BINDING_RELEASED'){allowed.delete(issues[i].key);issues.splice(i,1);}
    for(const booking of impact.bookings){
      const issue=routeIssue('ROUTE_BOOKING_IMPACT',[ref('booking',booking.booking_id),ref('service',booking.service_id)],booking,[{type:'service',id:booking.service_id,version:booking.source_version}]);issue.acknowledgement_required=true;issues.push(issue);allowed.add(issue.key);
    }
    const activated=new Set(s.placements.filter(p=>activePlacement(s,p)&&!activePlacement(before,before.placements.find(q=>q.id===p.id))).map(p=>p.id));
    const grouped=new Set(outcome.groups.flatMap(g=>g.changes.map(c=>c.placement_id)));
    for(const issue of issues)if(['PIN_MISMATCH','WINDOW_VIOLATION','DURATION_VIOLATION'].includes(issue.code)&&issue.refs.every(r=>activated.has(r.id)&&!grouped.has(r.id)&&s.placements.some(p=>p.id===r.id&&p.commitment==='tentative'))){issue.blocking=false;issue.acknowledgement_required=true;allowed.add(issue.key);}
  }
  return {...outcome,route_impact:impact,issues,can_apply:!issues.some(i=>i.blocking),allowed_acknowledgements:[...allowed].sort()};
}
