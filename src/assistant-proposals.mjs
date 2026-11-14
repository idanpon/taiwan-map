import { createHash, randomBytes } from 'node:crypto';
import { TRIP, fail } from './auth.mjs';
import { all, one, run, transaction } from './sqlite.mjs';
import { planningData } from './planning-store.mjs';
import { applyOperations, assertActor, readPlaces } from './assistant-changes.mjs';
import { proposalSchema, parse } from './assistant-schema.mjs';
import { planningModel,readSources } from './planning-domain-store.mjs';
import { readModel3,createChangeset,getChangeset,updateChangeset,previewChangeset,applyChangeset } from './planning-command-service.mjs';
import { presentChanges,sourceLabels,issueText } from '../public/planning-presentation.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const event=(db,user,id,action,payload)=>run(db,'INSERT INTO assistant_events VALUES(?,?,?,?,?,?)',crypto.randomUUID(),id,user.id,action,JSON.stringify(payload),Date.now());
function snapshot(db){
  return {places:readPlaces(db),planning:planningData(db),...(planningModel(db)===3?{planning_sources:readSources(db)}:{}),categories:all(db,'SELECT * FROM categories ORDER BY id'),statuses:all(db,'SELECT id,label,color,symbol,dimmed,version,archived FROM statuses WHERE trip_id=? AND archived=0 ORDER BY id',TRIP)};
}
export function assistantContext(db,user){
  const actor=assertActor(db,user),data=snapshot(db);
  return {actor,trip:data.planning.trip,categories:data.categories,statuses:data.statuses,places:data.places,planning:data.planning,...(planningModel(db)===3?{planning_v3:readModel3(db,user)}:{}),snapshot_hash:hash(data)};
}
function owned(db,user,id){
  assertActor(db,user);
  const p=one(db,'SELECT * FROM assistant_proposals WHERE id=? AND author_id=? AND trip_id=?',id,user.id,TRIP);
  if(!p)fail(404,'Предложение не найдено.');
  return p;
}
function present(p){return {id:p.id,title:p.title,version:p.version,status:p.status,author_id:p.author_id,...JSON.parse(p.payload),preview:p.preview?JSON.parse(p.preview):null,result:p.result?JSON.parse(p.result):null,created_at:p.created_at,updated_at:p.updated_at};}
export function readProposal(db,user,id){
 const value=present(owned(db,user,id));
 if(value.domain_changeset_id&&value.status!=='applied'){
  const draft=getChangeset(db,user,value.domain_changeset_id);
  if(draft.result){value.status='applied';value.result={...draft.result,status:'applied',proposal_id:id,title:value.title,version:value.version,changes:value.preview?.changes||[],labels:value.preview?.labels||{},warnings:value.preview?.warnings||[]};}
 }
 return value;
}
export function listProposals(db,user){
  assertActor(db,user);
  return {proposals:all(db,'SELECT id,title,version,status,created_at,updated_at FROM assistant_proposals WHERE author_id=? AND trip_id=? ORDER BY updated_at DESC LIMIT 100',user.id,TRIP).map(p=>({...p,status:readProposal(db,user,p.id).status}))};
}
export function saveProposal(db,user,input){
  assertActor(db,user,true);const value=parse(proposalSchema,input);
  if(Buffer.byteLength(JSON.stringify(value))>120000)fail(413,'Пакет слишком большой. Разделите его на независимые предложения.');
  const keys=value.operations.map(o=>o.key);
  if(new Set(keys).size!==keys.length)fail(400,'Ключи операций должны быть уникальны.');
  return transaction(db,()=>{
    const existing=one(db,'SELECT * FROM assistant_proposals WHERE id=?',value.id);
    if(existing&&existing.author_id!==user.id)fail(404,'Предложение не найдено.');
    const old=existing?JSON.parse(existing.payload):null;
    // Compare the unexpanded input as well: retry after a lost save response
    // must not allocate new IDs or advance a revision.
    const inputValue={title:value.title,operations:value.operations,...(value.planning_commands?{planning_commands:value.planning_commands}:{}),uncertainties:value.uncertainties};
    if(existing&&JSON.stringify(old.input)===JSON.stringify(inputValue))return present(existing);
    if(existing){
      if(['applied','cancelled'].includes(existing.status))fail(409,'Предложение уже завершено. Создайте новое.');
      if(value.version!==existing.version)fail(409,'Черновик изменён в другом чате. Прочитайте его снова.');
    }else{
      if(value.version!==undefined)fail(404,'Исходный черновик не найден.');
      if(one(db,"SELECT COUNT(*) n FROM assistant_proposals WHERE author_id=? AND status IN ('draft','ready')",user.id).n>=100)fail(400,'Сначала завершите или отмените старые черновики (лимит 100).');
    }
    const ids={};for(const op of value.operations)if(op.kind.endsWith('.create'))ids[op.key]=old?.ids[op.key]||crypto.randomUUID();
    const operations=structuredClone(value.operations);
    for(const op of operations)if(op.data?.options)op.data.options=op.data.options.map((o,index)=>({...o,id:o.id||old?.operations.find(p=>p.key===op.key)?.data?.options?.[index]?.id||crypto.randomUUID()}));
    let changeset=null;
    if(value.planning_commands){
      if(old?.operations?.length)fail(409,'Создайте отдельное предложение для новой модели.');
      const current=old?.domain_changeset_id?getChangeset(db,user,old.domain_changeset_id):null;
      changeset=current?updateChangeset(db,user,current.id,{version:3,expected_version:current.version,commands:value.planning_commands}):createChangeset(db,user,{version:3,commands:value.planning_commands});
    }else if(old?.domain_changeset_id)fail(409,'Нельзя заменить протокол существующего предложения.');
    const payload={operations,uncertainties:value.uncertainties,ids,input:inputValue,...(changeset?{domain_changeset_id:changeset.id,planning_commands:value.planning_commands}: {})},now=Date.now();
    if(existing)run(db,"UPDATE assistant_proposals SET title=?,version=version+1,status='draft',payload=?,preview=NULL,snapshot_hash=NULL,confirmation_token=NULL,updated_at=? WHERE id=?",value.title,JSON.stringify(payload),now,value.id);
    else run(db,'INSERT INTO assistant_proposals(id,trip_id,author_id,title,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',value.id,TRIP,user.id,value.title,JSON.stringify(payload),now,now);
    event(db,user,value.id,'save',{version:(existing?.version||0)+1});
    return readProposal(db,user,value.id);
  });
}
const omit=new Set(['id','trip_id','created_by','updated_by','created_at','updated_at','completed_at','version','state_version','catalog_version','tags_version','visibility_version']);
function display(value){
  const out=Object.fromEntries(Object.entries(value).filter(([k])=>!omit.has(k)));
  if(out.places)out.places=out.places.map(l=>Object.fromEntries(Object.entries(l).filter(([k])=>!['id','item_id','current_name','hidden'].includes(k))));
  if(out.options)out.options=out.options.map(({item_id,...o})=>o);
  return out;
}
function difference(before,after){
  const changes=[];
  for(const [entity,a,b] of [['place',before.places,after.places],['plan',before.planning.items,after.planning.items]]){
    const previous=new Map(a.map(row=>[row.id,row])),next=new Map(b.map(row=>[row.id,row]));
    for(const id of new Set([...next.keys(),...previous.keys()])){
      const old=previous.get(id),row=next.get(id),left=old?display(old):null,right=row?display(row):null;
      const fields=[...new Set([...Object.keys(right||{}),...Object.keys(left||{})])]
        .filter(key=>JSON.stringify(left?.[key])!==JSON.stringify(right?.[key]));
      if(fields.length)changes.push({entity,id,name:(row||old).name||(row||old).title,
        action:!row?'delete':old?'update':'create',fields,before:left,after:right});
    }
  }
  return changes;
}
export function previewProposal(db,user,id,version){
  assertActor(db,user,true);
  return transaction(db,()=>{
    const p=owned(db,user,id);if(p.version!==version)fail(409,'Ревизия предложения изменилась.');
    if(['applied','cancelled'].includes(p.status))fail(409,'Предложение уже завершено.');
    const payload=JSON.parse(p.payload);
    if(payload.domain_changeset_id){
      const current=getChangeset(db,user,payload.domain_changeset_id);
      const draft=previewChangeset(db,user,current.id,{version:current.version});
      const model=readModel3(db,user),domain=draft.preview,confirmation_token=randomBytes(24).toString('hex');
      const finalSources=structuredClone(model.sources);
      for(const c of domain.changes){const rows=finalSources[c.collection],index=rows.findIndex(r=>r.id===c.id);if(index<0)rows.push(c.after);else rows[index]=c.after;}
      const preview={proposal_id:id,version,confirmation_token,changes:presentChanges(domain.changes,finalSources),labels:sourceLabels(finalSources),warnings:domain.issues.map(issueText),uncertainties:payload.uncertainties,
        visibility:'Маршрут, подготовка, брони и документы доступны участникам поездки.',prepared_at:Date.now(),can_apply:domain.can_apply,acknowledgements:domain.allowed_acknowledgements.map(key=>({key,label:issueText(domain.issues.find(i=>i.key===key)||{code:key})})),
        domain_changeset:{id:draft.id,version:draft.version,fingerprint:domain.fingerprint,expires_at:draft.expires_at},reminder_impact:domain.reminder_impact};
      run(db,"UPDATE assistant_proposals SET status='ready',preview=?,snapshot_hash=?,confirmation_token=?,updated_at=? WHERE id=?",JSON.stringify(preview),domain.fingerprint,confirmation_token,Date.now(),id);
      return readProposal(db,user,id);
    }
    const before=snapshot(db),fingerprint=hash(before);
    if(p.status==='ready'&&p.snapshot_hash===fingerprint)return present(p);
    const rollback={};let after,warnings;
    // Use the actual write path against a savepoint. Every write, including
    // reminder refresh and audit events, is rolled back before returning UI.
    try{transaction(db,()=>{warnings=applyOperations(db,user,payload);after=snapshot(db);throw rollback;});}
    catch(error){if(error!==rollback)throw error;}
    const confirmation_token=randomBytes(24).toString('hex');
    const labels=Object.fromEntries([...before.planning.items,...after.places,...after.planning.items,...after.categories,...after.statuses,...after.planning.users,...after.planning.items.flatMap(i=>i.options||[])].map(v=>[v.id,v.name||v.title||v.label||v.display_name||v.id]));
    const preview={proposal_id:id,version,confirmation_token,changes:difference(before,after),labels,warnings,uncertainties:payload.uncertainties,reasons:payload.operations.map(o=>({key:o.key,reason:o.reason})),visibility:'Места публичны, если не скрыты. План и заметки доступны участникам.',prepared_at:Date.now()};
    run(db,"UPDATE assistant_proposals SET status='ready',preview=?,snapshot_hash=?,confirmation_token=?,updated_at=? WHERE id=?",JSON.stringify(preview),fingerprint,confirmation_token,Date.now(),id);
    return readProposal(db,user,id);
  });
}
export function applyProposal(db,user,input){
  assertActor(db,user,true);
  return transaction(db,()=>{
    const p=owned(db,user,input.id);
    if(input.version!==p.version||!input.confirmation_token||input.confirmation_token!==p.confirmation_token)fail(409,'Подтверждение относится к другому предпросмотру.');
    if(!['chat','button'].includes(input.confirmed_via))fail(400,'Подтвердите конкретный предпросмотр.');
    if(p.status==='applied')return JSON.parse(p.result);
    if(p.status!=='ready')fail(409,'Сначала обновите предпросмотр.');
    const routePayload=JSON.parse(p.payload);
    if(routePayload.domain_changeset_id){
      const preview=JSON.parse(p.preview),draft=preview.domain_changeset;
      const current=getChangeset(db,user,draft.id);
      const receipt=current.result||applyChangeset(db,user,draft.id,{version:draft.version,fingerprint:draft.fingerprint,idempotency_key:'proposal:'+p.id+':'+p.version,acknowledgements:input.acknowledgements||[]});
      const result={...receipt,status:'applied',proposal_id:p.id,title:p.title,version:p.version,applied_at:Date.now(),actor_id:user.id,changes:preview.changes,labels:preview.labels,warnings:preview.warnings,ids:current.preview?.resolved_ids||{}};
      run(db,"UPDATE assistant_proposals SET status='applied',result=?,updated_at=? WHERE id=?",JSON.stringify(result),Date.now(),p.id);
      event(db,user,p.id,'apply',{confirmed_via:input.confirmed_via,operation_id:receipt.operation_id});
      return result;
    }
    if(hash(snapshot(db))!==p.snapshot_hash)fail(409,'Данные поездки изменились. Обновите предпросмотр и подтвердите актуальные изменения.');
    const payload=JSON.parse(p.payload),before=snapshot(db),warnings=applyOperations(db,user,payload);
    const changes=difference(before,snapshot(db));
    const result={operation_id:idOf(p),status:'applied',proposal_id:p.id,title:p.title,version:p.version,applied_at:Date.now(),actor_id:user.id,changes,warnings,ids:payload.ids,labels:JSON.parse(p.preview).labels};
    run(db,"UPDATE assistant_proposals SET status='applied',result=?,updated_at=? WHERE id=?",JSON.stringify(result),Date.now(),p.id);
    event(db,user,p.id,'apply',{confirmed_via:input.confirmed_via,...result});
    return result;
  });
}
const idOf=p=>`${p.id}:${p.version}`;
export function keepDraft(db,user,id,version){
  assertActor(db,user,true);
  return transaction(db,()=>{const p=owned(db,user,id);if(p.version!==version||['applied','cancelled'].includes(p.status))fail(409,'Предложение изменено или завершено.');invalidateDomain(db,user,p);run(db,"UPDATE assistant_proposals SET status='draft',confirmation_token=NULL,preview=NULL,updated_at=? WHERE id=?",Date.now(),id);return readProposal(db,user,id);});
}
export function cancelProposal(db,user,id,version){
  assertActor(db,user,true);
  return transaction(db,()=>{const p=owned(db,user,id);if(p.version!==version||p.status==='applied')fail(409,'Предложение изменено или уже применено.');invalidateDomain(db,user,p);run(db,"UPDATE assistant_proposals SET status='cancelled',confirmation_token=NULL,preview=NULL,updated_at=? WHERE id=?",Date.now(),id);return readProposal(db,user,id);});
}
function invalidateDomain(db,user,p){
  const payload=JSON.parse(p.payload);if(!payload.domain_changeset_id)return;
  const current=getChangeset(db,user,payload.domain_changeset_id);
  if(current.result)fail(409,'Изменения уже применены. Прочитайте результат.');
  updateChangeset(db,user,current.id,{version:3,expected_version:current.version,commands:payload.planning_commands});
}
