import { transaction, all, one, run } from './sqlite.mjs';
import { TRIP, Problem } from './auth.mjs';
import { refreshItemReminders, refreshDeadlineReminders, reminderAnchor } from './reminders.mjs';
import { deadlineTarget } from '../public/planning-deadline-view.js';
import { normalizeCommands, evaluateFoundation, foundationCapabilities, PlanningDomainError, validId } from '../public/planning-domain.js';
import { authorizePlanning, requireModel3, readSources, sourceTables, insertRow, updateRow, fingerprint, problem } from './planning-domain-store.mjs';

import { preparationAllocations } from '../public/planning-preparation.js';
import { taskApplicable, activePlacement } from '../public/planning-readiness.js';
import { derivePlanning } from '../public/planning-projection.js';
import { scheduleAllocations } from '../public/planning-schedule-commands.js';
import { routeAllocations } from '../public/planning-route-commands.js';
import { resolveRoute, comparisonSources } from '../public/planning-scopes.js';
import { routeImpact } from '../public/planning-route-effects.js';
import { affectedReferences } from '../public/planning-impact.js';
import { documentAllocations } from '../public/planning-documents.js';
import { commandAssetGrants } from './document-assets.mjs';

const TTL = 15 * 60 * 1000;
function domain(fn) {
  try { return fn(); } catch (e) {
    if (!(e instanceof PlanningDomainError)) throw e;
    const error = new Problem(e.status, e.message); error.details={code:e.code,...(e.refs?{refs:e.refs}:{})}; throw error;
  }
}
function closed(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k)))
    problem(400,'INVALID_REQUEST','Неизвестное поле или неверная структура запроса.');
}
function commandBody(body) {
  if(body.version!==3)problem(400,'UNSUPPORTED_SCHEMA','Требуется версия команд 3.');
  return domain(()=>normalizeCommands(body.commands));
}
function allocate(commands, previous={}) {
  const ids=structuredClone(previous);
  for(const c of commands){
    ids[c.key] ??= {};
    for(const entity of domain(()=>[...preparationAllocations(c),...scheduleAllocations(c),...routeAllocations(c),...documentAllocations(c)])){
      const primary={create_need:'need',record_booking:'booking',add_service:'service',create_decision:'decision',add_option:'option',create_document:'document'}[c.type];
      const explicit=(entity===primary||c.expected_version===0&&entity==='link')?c.id:undefined;
      if(explicit!==undefined&&!validId(explicit))problem(400,'INVALID_ID','Некорректный ID.');
      if(explicit&&ids[c.key][entity]&&ids[c.key][entity]!==explicit)problem(409,'STABLE_ID_CHANGED','ID уже выделен.');
      ids[c.key][entity] ??= explicit||crypto.randomUUID();
    }
    if(c.type==='create_item'){
      if(c.id!==undefined&&!validId(c.id))problem(400,'INVALID_ID','Некорректный ID новой записи.');
      if(c.id && ids[c.key].item && c.id!==ids[c.key].item)problem(409,'STABLE_ID_CHANGED','ID уже выделен этому ключу команды.');
      ids[c.key].item ??= c.id||crypto.randomUUID();
      if(c.data.kind!=='task')ids[c.key].placement ??= crypto.randomUUID();
    }
    if(c.type==='link_place'&&c.expected_version===0){
      if(c.id!==undefined&&!validId(c.id))problem(400,'INVALID_ID','Некорректный ID новой связи.');
      if(c.id&&ids[c.key].link&&c.id!==ids[c.key].link)problem(409,'STABLE_ID_CHANGED','ID связи уже выделен.');
      ids[c.key].link ??= c.id||crypto.randomUUID();
    }
  }
  return ids;
}
function draft(db,user,id){
  const row=one(db,'SELECT * FROM planning_changesets WHERE id=? AND trip_id=? AND author_id=?',id,TRIP,user.id);
  if(!row)problem(404,'CHANGESET_UNAVAILABLE','Черновик недоступен.');
  return row;
}
function draftResponse(row){
  return {id:row.id,version:row.version,status:row.status,commands:JSON.parse(row.commands_json),stable_ids:JSON.parse(row.stable_ids_json),
    preview:row.preview_json?JSON.parse(row.preview_json):null,expires_at:row.expires_at,...(row.applied_result_json?{result:JSON.parse(row.applied_result_json)}:{})};
}
function mutable(row,version){
  if(row.version!==version)problem(409,'CHANGESET_VERSION_CONFLICT','Черновик изменился.');
  if(['applied','cancelled'].includes(row.status))problem(409,'CHANGESET_CLOSED','Пакет уже закрыт.');
}
function evaluate(db,user,commands,ids,now,expectedHash=null){
  const snapshot=readSources(db);
  const reminders=all(db,`SELECT r.* FROM planning_reminders r WHERE
    r.item_id IN (SELECT id FROM planning_items WHERE trip_id=?) OR
    r.deadline_id IN (SELECT id FROM planning_deadlines WHERE trip_id=?) ORDER BY r.id`,TRIP,TRIP);
  const assets=commandAssetGrants(db,user,commands,now);
  const hash=fingerprint({snapshot,reminders,commands,ids,assets,policy_version:6});
  if(expectedHash!==null&&hash!==expectedHash)problem(409,'PREVIEW_STALE','Данные поездки изменились. Пересмотрите последствия.');
  const result=domain(()=>evaluateFoundation(snapshot,commands,ids,{actorId:user.id,now,assets}));
  result.affected_references=affectedReferences(snapshot.sources,result.sources,result.changes);
  const beforeDerived=derivePlanning(snapshot.sources,now);
  const applicabilityChanged=new Set(result.sources.items.filter(i=>i.kind==='task'&&taskApplicable(snapshot.sources,snapshot.sources.items.find(t=>t.id===i.id))!==taskApplicable(result.sources,i)).map(i=>i.id));
  const moved=new Set(result.changes.filter(c=>c.collection==='items'&&c.before&&JSON.stringify(reminderAnchor(c.before))!==JSON.stringify(reminderAnchor(c.after))).map(c=>c.id));
  const changedDeadline=id=>{
    const before=deadlineTarget(snapshot.sources,id,undefined,now),after=deadlineTarget(result.sources,id,undefined,now);
    return JSON.stringify([reminderAnchor(before),before?._applicable,before?._reminder_timezone])!==JSON.stringify([reminderAnchor(after),after?._applicable,after?._reminder_timezone]);
  };
  const affected=reminders.filter(r=>(r.deadline_id?changedDeadline(r.deadline_id):moved.has(r.item_id)||applicabilityChanged.has(r.item_id))&&r.enabled&&r.sent_generation!==r.generation);
  const reminderImpact={mine:affected.filter(r=>r.user_id===user.id).map(r=>({id:r.id,...(r.deadline_id?{deadline_id:r.deadline_id}:{item_id:r.item_id}),version:r.version,action:applicabilityChanged.has(r.item_id)?'recheck_applicability':'recalculate_date'})),others_count:affected.filter(r=>r.user_id!==user.id).length};
  return {snapshot,result,reminderImpact,hash,beforeDerived,commands,assetExpiry:Math.min(...assets.map(a=>a.expires_at??Infinity))};
}
export function readModel3(db,user,now=Date.now()){
  return transaction(db,()=>{
    authorizePlanning(db,user);requireModel3(db);
    const snapshot=readSources(db), s=snapshot.sources, derived=derivePlanning(s,now);
    return {schema_version:3,revision:snapshot.trip.planning_revision,timezone_revision:snapshot.trip.timezone_revision,
      policy_version:6,evaluated_at:now,next_evaluation_at:derived.next_evaluation_at,capabilities:foundationCapabilities,...snapshot,
      working:{...resolveRoute(s),
        placement_ids:s.placements.filter(x=>activePlacement(s,x)).map(x=>x.id)},
      derived};
  });
}
export function evaluatePlanning(db,user,body,now=Date.now()){
  closed(body,body?.choices===undefined?['version','commands']:['version','choices']);
  return transaction(db,()=>{
    authorizePlanning(db,user);requireModel3(db);
    if(body.choices!==undefined){
      if(body.version!==3)problem(400,'UNSUPPORTED_SCHEMA','Требуется версия 3.');
      const snapshot=readSources(db),s=domain(()=>comparisonSources(snapshot.sources,body.choices)),working=resolveRoute(snapshot.sources),viewed=resolveRoute(s);
      return {schema_version:3,policy_version:6,context:'comparison',revision:snapshot.trip.planning_revision,viewed_choices:body.choices,working,viewed,derived:derivePlanning(s,now),route_impact:routeImpact(snapshot.sources,s,now),capabilities:foundationCapabilities};
    }
    const commands=commandBody(body),ids=allocate(commands),e=evaluate(db,user,commands,ids,now);
    return {schema_version:3,context:'preview',revision:e.snapshot.trip.planning_revision,stable_ids:ids,resolved_ids:e.result.resolved_ids,derived:e.result.derived,route_impact:e.result.route_impact,affected_references:e.result.affected_references,changes:e.result.changes,issues:e.result.issues,can_apply:e.result.can_apply,groups:e.result.groups,allowed_acknowledgements:e.result.allowed_acknowledgements,reminder_impact:e.reminderImpact,capabilities:foundationCapabilities};
  });
}
export function createChangeset(db,user,body,now=Date.now()){
  closed(body,['version','commands']);
  return transaction(db,()=>{
    authorizePlanning(db,user,true);requireModel3(db);
    const commands=commandBody(body), ids=allocate(commands), id=crypto.randomUUID();
    run(db,"INSERT INTO planning_changesets(id,trip_id,author_id,status,commands_json,stable_ids_json,created_at,updated_at) VALUES(?,?,?,'draft',?,?,?,?)",id,TRIP,user.id,JSON.stringify(commands),JSON.stringify(ids),now,now);
    return draftResponse(draft(db,user,id));
  });
}
export function getChangeset(db,user,id){
  return transaction(db,()=>{authorizePlanning(db,user);requireModel3(db);return draftResponse(draft(db,user,id));});
}
export function updateChangeset(db,user,id,body,now=Date.now()){
  closed(body,['version','expected_version','commands']);
  return transaction(db,()=>{
    authorizePlanning(db,user,true);requireModel3(db);
    const row=draft(db,user,id);mutable(row,body.expected_version);
    const commands=commandBody(body), ids=allocate(commands,JSON.parse(row.stable_ids_json));
    run(db,"UPDATE planning_changesets SET version=version+1,status='draft',commands_json=?,stable_ids_json=?,preview_json=NULL,base_revision=NULL,fingerprint=NULL,expires_at=NULL,updated_at=? WHERE id=?",JSON.stringify(commands),JSON.stringify(ids),now,id);
    return draftResponse(draft(db,user,id));
  });
}
export function previewChangeset(db,user,id,body,now=Date.now()){
  closed(body,['version']);
  return transaction(db,()=>{
    authorizePlanning(db,user,true);requireModel3(db);
    const row=draft(db,user,id);mutable(row,body.version);
    const e=evaluate(db,user,JSON.parse(row.commands_json),JSON.parse(row.stable_ids_json),now);
    const preview={context:'working',revision:e.snapshot.trip.planning_revision,fingerprint:e.hash,resolved_ids:e.result.resolved_ids,derived:e.result.derived,before_derived:e.beforeDerived,route_impact:e.result.route_impact,affected_references:e.result.affected_references,changes:e.result.changes,issues:e.result.issues,can_apply:e.result.can_apply,groups:e.result.groups,allowed_acknowledgements:e.result.allowed_acknowledgements,reminder_impact:e.reminderImpact,capabilities:foundationCapabilities};
    run(db,"UPDATE planning_changesets SET version=version+1,status='ready',preview_json=?,base_revision=?,fingerprint=?,expires_at=?,updated_at=? WHERE id=?",JSON.stringify(preview),preview.revision,e.hash,Math.min(now+TTL,e.result.derived.next_evaluation_at??Infinity,e.beforeDerived.next_evaluation_at??Infinity,e.assetExpiry),now,id);
    return draftResponse(draft(db,user,id));
  });
}
function receipt(db,user,key,hash){
  if(typeof key!=='string'||key.length<1||key.length>128)problem(400,'IDEMPOTENCY_KEY_REQUIRED','Укажите ключ повторного применения.');
  const previous=one(db,'SELECT request_hash,result_json FROM planning_operations WHERE trip_id=? AND actor_id=? AND idempotency_key=?',TRIP,user.id,key);
  if(previous&&previous.request_hash!==hash)problem(409,'IDEMPOTENCY_CONFLICT','Этот ключ использован для другого запроса.');
  return previous ? JSON.parse(previous.result_json) : null;
}
function persist(db,user,e,{key,hash,changesetId=null,now}){
  // Targets before their FK children; no DELETE/INSERT rewrite or disabled FKs.
  const rank={items:0,scopes:1,options:1,decisions:1,placements:2,bookings:1,needs:2,services:2,placement_places:3,service_places:3,need_targets:3,need_tasks:3,need_services:3,need_task_results:3,service_tasks:3,task_prerequisites:3,need_exemptions:3,deadlines:3,deadline_rules:4,constraints:3,time_links:3,transition_overrides:3,reschedule_requests:3,option_constraints:3,decision_gaps:3,need_decision_results:3,decision_prerequisites:3};
  Object.assign(rank,{documents:2,booking_documents:3});
  const changes=[...e.result.changes].sort((a,b)=>rank[a.collection]-rank[b.collection]);
  // Close old links before replacements hit partial unique indexes. FK checks remain enabled.
  for(const change of changes.filter(c=>c.before&&c.after.archived_at!=null))updateRow(db,sourceTables[change.collection],change.after);
  // Supplier replacement links may point forward within this atomic package.
  run(db,'PRAGMA defer_foreign_keys=ON');
  for(const change of changes){
    const table=sourceTables[change.collection];
    if(change.before&&change.after.archived_at!=null)continue;
    if(change.before)updateRow(db,table,change.after);else insertRow(db,table,change.after);
  }
  for(const item of e.result.sources.items){
    const old=e.snapshot.sources.items.find(i=>i.id===item.id);if(!old)continue;
    refreshItemReminders(db,old,item,now,{beforeApplicable:old.kind==='task'?taskApplicable(e.snapshot.sources,old):old.archived_at==null,applicable:item.kind==='task'?taskApplicable(e.result.sources,item):item.archived_at==null});
  }
  refreshDeadlineReminders(db,e.snapshot.sources,e.result.sources,now);
  const operationId=crypto.randomUUID(),result={schema_version:3,operation_id:operationId,revision:one(db,'SELECT planning_revision FROM trips WHERE id=?',TRIP).planning_revision,
    changed:changes.map(c=>({type:c.collection,id:c.id,version:c.after.version}))};
  insertRow(db,'planning_operations',{id:operationId,trip_id:TRIP,actor_id:user.id,idempotency_key:key,request_hash:hash,changeset_id:changesetId,result_json:JSON.stringify(result),applied_at:now});
  const eventId=crypto.randomUUID();
  insertRow(db,'planning_events',{id:eventId,trip_id:TRIP,item_id:null,actor_id:user.id,action:'model3_apply',payload:JSON.stringify({commands:e.commands,changes,issues:e.result.issues,acknowledgements:e.acknowledgements||[]}),created_at:now,operation_id:operationId});
  for(const id of e.result.affected_references.items)
    run(db,'INSERT INTO planning_event_refs(event_id,item_id) VALUES(?,?)',eventId,id);
  for(const id of e.result.affected_references.placements)
    run(db,'INSERT INTO planning_event_refs(event_id,placement_id) VALUES(?,?)',eventId,id);
  for(const id of e.result.affected_references.documents)
    run(db,'INSERT INTO planning_document_event_refs(event_id,document_id) VALUES(?,?)',eventId,id);
  for(const [collection,column] of [['needs','need_id'],['bookings','booking_id'],['services','service_id']])
    for(const id of e.result.affected_references[collection])
      run(db,'INSERT INTO planning_result_event_refs(event_id,'+column+') VALUES(?,?)',eventId,id);
  return result;
}
export function applyChangeset(db,user,id,body,now=null){
  closed(body,['version','fingerprint','idempotency_key','acknowledgements']);
  if(body.acknowledgements!==undefined&&(!Array.isArray(body.acknowledgements)||body.acknowledgements.some(k=>typeof k!=='string')||new Set(body.acknowledgements).size!==body.acknowledgements.length))problem(400,'INVALID_ACKNOWLEDGEMENT','Подтверждения должны содержать уникальные ключи последствий.');
  return transaction(db,()=>{
    // The lock may have waited: expiry is checked against the time after acquisition.
    now ??= Date.now();
    authorizePlanning(db,user,true);requireModel3(db);
    const row=draft(db,user,id),hash=fingerprint({id,body});
    const previous=receipt(db,user,body.idempotency_key,hash);if(previous)return previous;
    mutable(row,body.version);
    if(row.status!=='ready'||row.fingerprint!==body.fingerprint||row.expires_at<=now)
      problem(409,'PREVIEW_STALE','Предпросмотр устарел. Обновите его; черновик сохранён.');
    const e=evaluate(db,user,JSON.parse(row.commands_json),JSON.parse(row.stable_ids_json),now,row.fingerprint);
    if(!e.result.can_apply)problem(422,'SCHEDULE_BLOCKED','В предлагаемом пакете есть блокирующие конфликты расписания.');
    const acknowledgements=[...(body.acknowledgements||[])].sort();
    if(JSON.stringify(acknowledgements)!==JSON.stringify(e.result.allowed_acknowledgements))problem(422,'ACKNOWLEDGEMENTS_REQUIRED','Подтвердите ровно те последствия, которые перечислены в этом предпросмотре.');
    e.acknowledgements=acknowledgements;
    const result=persist(db,user,e,{key:body.idempotency_key,hash,changesetId:id,now});
    run(db,"UPDATE planning_changesets SET version=version+1,status='applied',applied_result_json=?,updated_at=? WHERE id=?",JSON.stringify(result),now,id);
    return result;
  });
}
// The only no-preview domain write: metadata, with the same authorization/audit/receipt.
export function applyMetadataCommands(db,user,body,now=Date.now()){
  closed(body,['version','commands','idempotency_key']);
  return transaction(db,()=>{
    authorizePlanning(db,user,true);requireModel3(db);
    const commands=commandBody(body);
    if(commands.some(c=>c.type!=='edit_item'))problem(409,'PREVIEW_REQUIRED','Для этого изменения нужен предварительный просмотр.');
    const hash=fingerprint(body),previous=receipt(db,user,body.idempotency_key,hash);if(previous)return previous;
    return persist(db,user,evaluate(db,user,commands,{},now),{key:body.idempotency_key,hash,now});
  });
}
