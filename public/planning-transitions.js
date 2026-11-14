import { live, serviceState } from './planning-readiness.js';

export const BUFFER_POLICY_VERSION=1;
export const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const compare=(a,b)=>a<b?-1:a>b?1:0;
export function distanceBuffer(metres){
  if(metres===null)return {minutes:15,range:'unknown',status:'unknown'};
  for(const [limit,minutes] of [[500,10],[1000,20],[3000,30],[5000,45],[10000,60],[30000,90]])if(metres<=limit)return {minutes,range:'<='+limit,status:'estimated'};
  if(metres<=100000)return {minutes:90+30*Math.ceil((metres-30000)/30000),range:'30000<d<=100000',status:'estimated'};
  return {minutes:null,range:'>100000',status:'unresolved_long_transfer'};
}
export function haversine(a,b){
  const rad=Math.PI/180,dlat=(b.lat-a.lat)*rad,dlon=(b.lon-a.lon)*rad;
  const h=Math.min(1,Math.max(0,Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2));
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
export function boundServices(s,p,now){
  const needIds=new Set((s.need_targets||[]).filter(l=>live(l)&&l.placement_id===p.id&&s.needs.some(n=>live(n)&&n.id===l.need_id&&n.lifecycle==='active')).map(l=>l.need_id));
  const serviceIds=new Set((s.need_services||[]).filter(l=>live(l)&&needIds.has(l.need_id)).map(l=>l.service_id));
  return s.services.filter(v=>live(v)&&serviceIds.has(v.id)&&['held','confirmed'].includes(serviceState(v,now)));
}
function endpoint(s,p,side){
  const item=s.items.find(i=>i.id===p.item_id),role=item.kind==='transport'?(side==='from'?'arrival':'departure'):item.kind==='stay'?'lodging':'visit';
  const all=s.placement_places.filter(l=>live(l)&&l.placement_id===p.id&&l.role===role);
  const chosen=all.filter(l=>l.selection==='chosen'),links=chosen.length?chosen:all.filter(l=>l.selection==='candidate');
  const points=links.map(l=>{
    const place=s.places.find(v=>v.id===l.place_id),valid=place&&typeof place.lat==='number'&&typeof place.lon==='number'&&Number.isFinite(place.lat)&&Number.isFinite(place.lon)&&Math.abs(place.lat)<=90&&Math.abs(place.lon)<=180;
    return {link_id:l.id,place_id:l.place_id,role:l.role,selection:l.selection,lat:valid?place.lat:null,lon:valid?place.lon:null,quality:place?.coordinate_accuracy??null,source:place?.coordinate_source_url??null};
  }).sort((a,b)=>compare(canonical(a),canonical(b)));
  return {points,candidates:!chosen.length&&links.length>0,incomplete:!points.length||points.some(p=>p.lat===null)};
}
export function transitionContext(s,from,to,serviceId=null){
  const service=serviceId?s.services.find(v=>v.id===serviceId&&live(v)):null;
  return canonical({policy:BUFFER_POLICY_VERSION,from:from.id,to:to.id,from_points:endpoint(s,from,'from').points,to_points:endpoint(s,to,'to').points,
    service:serviceId?{id:serviceId,version:service?.version??null,starts_at:service?.starts_at??null,ends_at:service?.ends_at??null,date_start:service?.date_start??null,date_end:service?.date_end??null}:null});
}
export function transition(s,from,to,now){
  const a=endpoint(s,from,'from'),b=endpoint(s,to,'to');let distance=null,pair=null;
  for(const p of a.points.filter(p=>p.lat!==null))for(const q of b.points.filter(p=>p.lat!==null)){
    const d=haversine(p,q);if(distance===null||d<distance){distance=d;pair=[p.place_id,q.place_id];}
  }
  const suggested=distanceBuffer(distance),matches=(s.transition_overrides||[]).filter(o=>live(o)&&o.from_placement_id===from.id&&o.to_placement_id===to.id);
  const valid=matches.filter(o=>o.context_hash===transitionContext(s,from,to,o.service_id));
  // A second current override is never selected by array order.
  const override=valid.length===1?valid[0]:null,ambiguous=valid.length>1;
  const movement=ambiguous?null:override?(override.mode==='disabled'?0:override.minutes):suggested.minutes;
  const previous=boundServices(s,from,now),next=boundServices(s,to,now);
  const exit=Math.max(0,...previous.map(v=>v.exit_allowance_minutes||0)),arrival=Math.max(0,...next.map(v=>v.arrival_lead_minutes||0));
  const links=(s.time_links||[]).filter(l=>live(l)&&l.from_placement_id===from.id&&l.to_placement_id===to.id);
  const minimum=Math.max(0,...links.map(l=>l.minimum_minutes));
  return {from_placement_id:from.id,to_placement_id:to.id,distance_m:distance,closest_place_ids:pair,range:suggested.range,
    suggested_minutes:suggested.minutes,mode:override?.mode||'auto',movement_minutes:movement,
    required_minutes:movement===null?null:Math.max(minimum,movement+exit+arrival),mandatory_minutes:Math.max(minimum,exit+arrival),
    status:ambiguous?'override_conflict':suggested.status,approximate:!override?.route_checked,candidates:a.candidates||b.candidates,incomplete_points:a.incomplete||b.incomplete,
    override_id:override?.id||null,stale_override_ids:matches.filter(o=>!valid.includes(o)).map(o=>o.id),
    context_hash:transitionContext(s,from,to),components:{movement_minutes:movement,exit_minutes:exit,arrival_minutes:arrival,precedence_minutes:minimum},
    sources:[{type:'buffer_policy',version:BUFFER_POLICY_VERSION},...(override?[{type:'transition_override',id:override.id,version:override.version}]:[]),
      ...previous.filter(v=>v.exit_allowance_minutes>0).map(v=>({type:'service',id:v.id,version:v.version,rule:'exit_allowance',minutes:v.exit_allowance_minutes})),
      ...next.filter(v=>v.arrival_lead_minutes>0).map(v=>({type:'service',id:v.id,version:v.version,rule:'arrival_lead',minutes:v.arrival_lead_minutes})),
      ...links.map(l=>({type:'time_link',id:l.id,version:l.version,minutes:l.minimum_minutes}))]};
}
