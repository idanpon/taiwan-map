import {live,activePlacement,nights} from './planning-readiness.js';
import {comparisonSources,scopeAncestor} from './planning-scopes.js';
import {derivePlanning} from './planning-projection.js';
import {civil,localInstants} from './trip-timezones.js';

export const ref=(command,entity)=>({command,entity});
export const byId=(s,collection,id)=>s[collection]?.find(r=>r.id===id);
export const activeRows=(s,collection)=>s[collection].filter(live);
// Select the entity whose optimistic version belongs to a command. Decision and
// item IDs can coincide, so resolving by ID alone is not sufficient.
export function commandVersionTarget(c,s){
 const special={ensure_preparation:['needs','need_id'],add_option:['decisions','decision_id'],add_variant_placement:['items','item_id']};
 const [collection,key]=special[c.type]||[];
 if(collection)return typeof c[key]==='string'?{collection,id:c[key]}:null;
 if(typeof c.id!=='string'||!c.expected_version)return null;
 const decision=['choose_working','accept_decision','reopen_decision','clear_working'].includes(c.type);
 if(decision)return {collection:'decisions',id:c.id};
 const matches=Object.entries(s).filter(([key,rows])=>key!=='decisions'&&Array.isArray(rows)&&rows.some(r=>r.id===c.id));
 // Caller-supplied IDs can coincide across collections. Never rebase an
 // ambiguous target; the server keeps the original optimistic check intact.
 return matches.length===1?{collection:matches[0][0],id:c.id}:null;
}
export function viewedModel(model,choices={}){
 const valid=Object.entries(choices).filter(([id,option])=>model.sources.decisions.some(d=>live(d)&&d.id===id)&&model.sources.options.some(o=>live(o)&&o.id===option&&o.item_id===id));
 if(!valid.length)return model;
 const sources=comparisonSources(model.sources,valid.map(([decision_id,option_id])=>({decision_id,option_id})));
 return {...model,sources,derived:derivePlanning(sources,model.evaluated_at)};
}
export function placementDays(p,item){
 if(!p.date_start&&!p.date_end)return [];
 const start=p.date_start||p.date_end,end=p.date_end||start;
 return item.kind==='stay'?nights(start,end):nights(start,new Date(Date.parse(end)+86400000).toISOString().slice(0,10));
}
export function preparationRows(model,{mode='trip',day,search='',state='active'}={}){
 const s=model.sources,match=i=>!search||[i.title,i.description,i.note].join(' ').toLowerCase().includes(search.toLowerCase());
 return model.derived.tasks.map(d=>({...byId(s,'items',d.id),derived:d})).filter(match).filter(t=>state==='active'?!['done','cancelled'].includes(t.state):!state||t.state===state).filter(t=>{
  if(mode==='trip')return true;
  if(mode==='scheduled_day')return model.derived.deadlines.some(d=>d.task_id===t.id&&(d.local_date===day||d.at&&civil(d.at,byId(s,'deadlines',d.id)?.timezone||'Asia/Taipei').day===day));
  const needIds=s.need_tasks.filter(l=>live(l)&&l.task_id===t.id).map(l=>l.need_id);
  return s.need_targets.some(l=>live(l)&&needIds.includes(l.need_id)&&s.placements.some(p=>p.id===l.placement_id&&activePlacement(s,p)&&placementDays(p,byId(s,'items',p.item_id)).includes(day)));
 });
}
export function calendarFacts(model,day){
 const s=model.sources;
 return {count:s.placements.filter(p=>activePlacement(s,p)&&placementDays(p,byId(s,'items',p.item_id)).includes(day)).length,
  housing:model.derived.housing_coverage.some(c=>c.night===day)};
}
export function routeEntries(model,scopeId,{day=null,kind='',state='active',search=''}={}){
 const s=model.sources,match=i=>(!kind||i.kind===kind)&&(!state||(state==='active'?!['done','cancelled'].includes(i.state):i.state===state))&&(!search||[i.title,i.description,i.note].join(' ').toLowerCase().includes(search));
 const placements=s.placements.filter(p=>live(p)&&p.scope_id===scopeId&&p.participation==='included'&&live(byId(s,'items',p.item_id))&&match(byId(s,'items',p.item_id))&&(!day||placementDays(p,byId(s,'items',p.item_id)).includes(day)||!p.date_start)).map(p=>({type:'placement',row:p,date:p.date_start||'9999',order:p.starts_at||String(p.order_key).padStart(8,'0')}));
 const decisions=activeRows(s,'decisions').filter(d=>d.scope_id===scopeId).map(d=>{
  const optionScopes=s.scopes.filter(sc=>live(sc)&&s.options.some(o=>live(o)&&o.id===sc.option_id&&o.item_id===d.id));
  const members=s.placements.filter(p=>live(p)&&p.participation==='included'&&optionScopes.some(sc=>scopeAncestor(s,sc.id,p.scope_id)));
  const gap=s.decision_gaps.find(g=>live(g)&&g.decision_id===d.id);
  const dates=members.flatMap(p=>placementDays(p,byId(s,'items',p.item_id))).sort();
  return {matches:match(byId(s,'items',d.id))||members.some(p=>match(byId(s,'items',p.item_id))),type:'decision',row:d,date:dates[0]||gap?.date_start||'9999',end:dates.at(-1)||gap?.date_end,order:''};
 }).filter(e=>e.matches&&(!day||e.date==='9999'||e.date<=day&&(!e.end||e.end>=day)));
 return [...placements,...decisions].sort((a,b)=>a.date.localeCompare(b.date)||a.order.localeCompare(b.order)||a.row.id.localeCompare(b.row.id));
}
export function localInput(at,zone){if(!at)return '';const c=civil(at,zone||'Asia/Taipei');return c.day+'T'+c.time;}
export function instantInput(value,zone){
 if(!value)return null;const [day,time]=value.split('T'),values=localInstants(day,time,zone);
 if(values.length!==1)throw Error(values.length?'Это время встречается дважды в выбранном поясе. Уточните пояс или время.':'Такого местного времени нет в выбранном поясе.');
 return new Date(values[0]).toISOString();
}
export function slotInput(v){
 const precision=v.precision||'exact',start_timezone=v.start_timezone||'Asia/Taipei',end_timezone=v.end_timezone||start_timezone;
 const exact=['exact','approximate'].includes(precision),starts_at=exact?instantInput(v.starts_at,start_timezone):null,ends_at=exact?instantInput(v.ends_at,end_timezone):null;
 return {precision,start_timezone,end_timezone,starts_at,ends_at,date_start:precision==='unscheduled'?null:starts_at?civil(starts_at,start_timezone).day:v.date_start||null,date_end:precision==='unscheduled'?null:ends_at?civil(ends_at,end_timezone).day:v.date_end||v.date_start||null,part_of_day:precision==='part_of_day'?v.part_of_day||'morning':null,intended_duration_minutes:starts_at&&ends_at?(Date.parse(ends_at)-Date.parse(starts_at))/60000:null};
}
