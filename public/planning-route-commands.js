import { closed, validId, reference, checkVersion, textField, invalid } from './planning-domain-common.js';
import { validDate } from './planning-model.js';
import { live, activePlacement } from './planning-readiness.js';
import { scopeAncestor, scopePath, scopeActive, decisionActive, compatibleScopes, routeError, resolveRoute } from './planning-scopes.js';
import { validateRouteGraph } from './planning-route-validation.js';

const identity=['title','description','note','priority','assignee_id'];
export const routeFields={
  create_decision:['id','scope_id','data'],add_option:['id','decision_id','expected_version','data'],edit_option:['id','expected_version','data'],
  archive_option:['id','expected_version','reason'],restore_option:['id','expected_version','reason'],copy_option:['id','expected_version','data'],
  reassign_route_owner:['id','expected_version','decision_id','scope_id','mappings','reason'],
  add_variant_placement:['item_id','option_id','expected_version','source_placement_id'],archive_placement:['id','expected_version','reason'],set_participation:['id','expected_version','participation'],
  set_task_scope:['id','expected_version','scope_id'],set_need_scope:['id','expected_version','scope_id'],
  choose_working:['id','expected_version','option_id'],accept_decision:['id','expected_version'],reopen_decision:['id','expected_version','reason'],clear_working:['id','expected_version','mode','data','reason'],
  set_option_constraint:['id','expected_version','option_id','other_option_id','relation'],remove_option_constraint:['id','expected_version'],
  set_decision_result:['id','expected_version','need_id','decision_id','required_option_id'],remove_decision_result:['id','expected_version'],
  set_decision_prerequisite:['id','expected_version','task_id','decision_id','required_option_id'],remove_decision_prerequisite:['id','expected_version'],
};
export function validateRouteCommand(c){
  if(c.type==='create_decision'){if(c.id!==undefined&&!validId(c.id))invalid('INVALID_ID','Некорректный ID.');closed(c.data,identity);}
  else if(!Number.isSafeInteger(c.expected_version)||c.expected_version<(c.type.startsWith('set_')&&['set_option_constraint','set_decision_result','set_decision_prerequisite'].includes(c.type)?0:1))invalid('EXPECTED_VERSION_REQUIRED','Укажите ожидаемую версию.',400);
  if(['add_option','edit_option','copy_option'].includes(c.type))closed(c.data,['label','description','sort_order']);
  if(c.type==='clear_working'){if(!['retain_placeholder','exclude_segment'].includes(c.mode))invalid('INVALID_CLEAR_MODE','Явно выберите плейсхолдер или исключение участка.');closed(c.data||{},['label','date_start','date_end','location_hint']);}
  if(c.type==='reassign_route_owner'){
    if(!Array.isArray(c.mappings)||!c.mappings.length||c.mappings.length>100)invalid('INVALID_OWNER_MAPPING','Укажите все сохраняемые размещения.');
    for(const m of c.mappings)closed(m,['placement_id','option_id']);
  }
  if(c.type==='set_option_constraint'&&!['requires_option','excludes_option'].includes(c.relation))invalid('INVALID_OPTION_RELATION','Неизвестное условие варианта.');
}
export function routeAllocations(c){
  if(c.type==='create_decision')return ['decision','gap'];
  if(['add_option','copy_option'].includes(c.type))return ['option','scope'];
  if(c.type==='add_variant_placement')return ['placement'];
  if(c.type==='clear_working')return ['gap'];
  if(['set_option_constraint','set_decision_result','set_decision_prerequisite'].includes(c.type)&&c.expected_version===0)return ['link'];
  return [];
}
const structural=new Set(['add_variant_placement','reassign_route_owner','copy_option','archive_placement','set_participation','set_task_scope','set_need_scope']);
const linkTypes={option_constraint:'option_constraints',decision_result:'need_decision_results',decision_prerequisite:'decision_prerequisites'};
export function routeContext(ctx){
  const {sources:s,before,ids,root,audit,mark,now,actorId,trip,createItem}=ctx,reopened=new Set(),accepted=new Set(),choiceChanged=new Set(),materialDecisions=new Set(),copies=[];
  let resolved=ids;
  const collections={item:'items',decision:'decisions',option:'options',scope:'scopes',placement:'placements',need:'needs'};
  const ref=(value,entity,archived=false)=>{const id=reference(value,resolved,entity),row=s[collections[entity]].find(x=>x.id===id);if(!row||!archived&&!live(row))routeError('TARGET_UNAVAILABLE','Связанная запись недоступна.',[{type:entity,id}]);return row;};
  const version=(row,c,key,restore=false)=>{const old=before[key].find(x=>x.id===row?.id)||row;if(restore){if(!old||old.version!==c.expected_version)invalid('VERSION_CONFLICT','Запись изменилась.',409);}else checkVersion(old,c);};
  function add(key,id,data){if(!validId(id)||s[key].some(x=>x.id===id))invalid('ID_CONFLICT','ID уже занят.',409);const row={id,...(key==='options'?{}:{trip_id:trip.id}),...data,...audit};s[key].push(row);mark(key,row);return row;}
  function archive(key,row){row.archived_at=now;row.archived_by=actorId;mark(key,row);}
  function parent(option){return s.decisions.find(d=>d.id===option.item_id);}
  function optionScope(option){return s.scopes.find(x=>x.option_id===option.id);}
  function requireRouteOption(option){const d=parent(option);if(!live(d))routeError('LEGACY_DECISION_UNSUPPORTED','Прежнее решение мест не является вариантом участка.',[{type:'option',id:option.id}]);return d;}
  function validateOption(o){textField(o.label,'Название варианта',300,true);textField(o.description,'Описание',10000);if(!Number.isSafeInteger(o.sort_order)||Math.abs(o.sort_order)>1000000)invalid('INVALID_ORDER','Некорректный порядок.');}
  function addOption(id,scopeId,d,data){const o=add('options',id,{item_id:d.id,label:'',description:'',sort_order:0,...data});validateOption(o);add('scopes',scopeId,{parent_scope_id:d.scope_id,option_id:o.id});mark('decisions',d);mark('items',s.items.find(i=>i.id===d.id));return o;}
  function bootstrap(commands){
    for(const c of commands.filter(c=>c.type==='create_decision')){
      const id=ids[c.key].decision,item=createItem(id,null,{kind:'decision',...c.data}),scopeId=c.scope_id?reference(c.scope_id,ids,'scope'):root.id;
      ids[c.key].item=id;item.activation_scope_id=scopeId;item.decision_mode='route_segment';
      add('decisions',id,{scope_id:scopeId,working_option_id:null,accepted_option_id:null,resolution:'open'});
      add('decision_gaps',ids[c.key].gap,{decision_id:id,label:c.data.title,date_start:null,date_end:null,location_hint:null});
    }
    for(const c of commands.filter(c=>c.type==='add_option')){const d=ref(c.decision_id,'decision');version(d,c,'decisions');addOption(ids[c.key].option,ids[c.key].scope,d,c.data);}
  }
  function copyPlacement(source,id,scopeId){
    if(source.item_id&&s.items.find(i=>i.id===source.item_id)?.state==='done')routeError('COMPLETED_ROUTE_IMMUTABLE','Выполненный пункт нельзя размножить как план.',[{type:'placement',id:source.id}]);
    const targets=s.need_targets.filter(l=>live(l)&&l.placement_id===source.id&&s.needs.some(n=>live(n)&&n.id===l.need_id));
    const inaccessible=targets.filter(l=>!scopeAncestor(s,s.needs.find(n=>n.id===l.need_id).scope_id,scopeId));
    if(inaccessible.length)routeError('BRANCH_PREPARATION_MAPPING_REQUIRED','Для подготовки отдельной ветви сначала задайте общую область потребности или создайте назначения явно.',inaccessible.map(l=>({type:'need',id:l.need_id})));
    const p=add('placements',id,{...source,id,scope_id:scopeId,commitment:'tentative',approved_context_json:null});
    copies.push({source_id:source.id,placement_id:id});
    for(const [key,links] of [['placement_places',s.placement_places.filter(l=>live(l)&&l.placement_id===source.id)],['constraints',s.constraints.filter(l=>live(l)&&l.placement_id===source.id)],['need_targets',targets]]){
      for(const [i,l] of links.entries()){add(key,id+'_'+key+'_'+i,{...l,id:id+'_'+key+'_'+i,placement_id:id});if(l.need_id)mark('needs',s.needs.find(n=>n.id===l.need_id));}
    }
    mark('items',s.items.find(i=>i.id===p.item_id));return p;
  }
  function applyStructural(c){
    if(!structural.has(c.type))return;
    if(c.type==='copy_option'){
      const source=ref(c.id,'option');version(source,c,'options');const d=requireRouteOption(source),oldScope=optionScope(source);
      if(s.decisions.some(x=>live(x)&&x.scope_id===oldScope.id))routeError('COPY_NESTED_DECISION_UNSUPPORTED','Вложенное решение добавьте явно; его рабочий выбор нельзя скопировать неявно.',[{type:'option',id:source.id}]);
      const o=addOption(ids[c.key].option,ids[c.key].scope,d,{label:source.label,description:source.description,sort_order:source.sort_order,...c.data}),scope=optionScope(o);
      for(const [i,p] of s.placements.filter(p=>live(p)&&p.scope_id===oldScope.id).entries())copyPlacement(p,ids[c.key].option+'_p'+i,scope.id);
      return;
    }
    if(c.type==='add_variant_placement'){
      const item=ref(c.item_id,'item'),option=ref(c.option_id,'option');version(item,c,'items');const d=requireRouteOption(option);
      if(item.route_owner_decision_id!==d.id)routeError('MULTIPLE_PLACEMENT_OWNERS','Сначала явно передайте пункт единственному владельцу.',[{type:'item',id:item.id},{type:'decision',id:d.id},...(item.route_owner_decision_id?[{type:'decision',id:item.route_owner_decision_id}]:[])]);
      const source=c.source_placement_id?ref(c.source_placement_id,'placement'):null;if(source&&source.item_id!==item.id)routeError('PLACEMENT_ITEM_MISMATCH','Источник размещения должен принадлежать тому же пункту.');
      if(source)copyPlacement(source,ids[c.key].placement,optionScope(option).id);
      else{
        const template=s.placements.find(p=>p.item_id===item.id),p=add('placements',ids[c.key].placement,{...template,id:ids[c.key].placement,item_id:item.id,scope_id:optionScope(option).id,participation:'included',commitment:'tentative',precision:'unscheduled',date_start:null,date_end:null,starts_at:null,ends_at:null,start_timezone:null,end_timezone:null,part_of_day:null,intended_duration_minutes:null,order_key:0,location_state:'unspecified',approved_context_json:null});
        const needs=[...new Set(s.need_targets.filter(l=>live(l)&&s.needs.some(n=>live(n)&&n.id===l.need_id)&&s.placements.some(q=>q.id===l.placement_id&&q.item_id===item.id)&&scopeAncestor(s,ref(l.need_id,'need').scope_id,p.scope_id)).map(l=>l.need_id))];
        for(const [i,id] of needs.entries()){add('need_targets',p.id+'_need_'+i,{need_id:id,placement_id:p.id});mark('needs',ref(id,'need'));}
      }
      mark('items',item);return;
    }
    if(c.type==='reassign_route_owner'){
      const item=ref(c.id,'item');version(item,c,'items');textField(c.reason,'Причина передачи',2000,true);
      if(!['visit','stay','transport'].includes(item.kind)||['done','cancelled'].includes(item.state))routeError('ROUTE_ITEM_REQUIRED','Владельца меняет только незавершённый маршрутный пункт.');
      const d=c.decision_id===null?null:ref(c.decision_id,'decision'),scope=d?ref(d.scope_id,'scope'):ref(c.scope_id||root.id,'scope');
      const placements=s.placements.filter(p=>live(p)&&p.item_id===item.id),mapped=new Set();
      for(const m of c.mappings){const p=ref(m.placement_id,'placement');if(p.item_id!==item.id||mapped.has(p.id))routeError('INVALID_OWNER_MAPPING','Mapping должен однозначно перечислять размещения этого пункта.');mapped.add(p.id);
        const o=m.option_id===null?null:ref(m.option_id,'option');if(d?o?.item_id!==d.id:o!==null)routeError('OPTION_OWNER_MISMATCH','Назначения должны принадлежать новому владельцу.');p.scope_id=o?optionScope(o).id:scope.id;mark('placements',p);
      }
      if(mapped.size!==placements.length)routeError('INCOMPLETE_OWNER_MAPPING','Передача должна сохранять все живые размещения; ненужные архивируйте явно.',placements.map(p=>({type:'placement',id:p.id})));
      if(item.route_owner_decision_id)materialDecisions.add(item.route_owner_decision_id);if(d)materialDecisions.add(d.id);
      item.route_owner_decision_id=d?.id??null;item.activation_scope_id=scope.id;mark('items',item);return;
    }
    const collection=c.type==='set_task_scope'?'items':c.type==='set_need_scope'?'needs':'placements',entity=collection==='items'?'item':collection==='needs'?'need':'placement',row=ref(c.id,entity);version(row,c,collection);
    if(c.type==='set_task_scope'){if(row.kind!=='task')invalid('TASK_REQUIRED','Нужна задача.');row.activation_scope_id=ref(c.scope_id,'scope').id;}
    else if(c.type==='set_need_scope')row.scope_id=ref(c.scope_id,'scope').id;
    else{const item=s.items.find(i=>i.id===row.item_id);if(['done','cancelled'].includes(item.state))routeError('COMPLETED_ROUTE_IMMUTABLE','Историческое размещение нельзя изменить.');if(c.type==='archive_placement'){textField(c.reason,'Причина',2000,true);archive(collection,row);}else{if(!['included','excluded'].includes(c.participation))invalid('INVALID_PARTICIPATION','Нужен явный режим участия.');row.participation=c.participation;}mark('items',item);}
    mark(collection,row);
  }
  function finishStructural(){
    // Expand explicit links by shared item identity only after all destination placements exist.
    for(const copy of copies){
      const p=ref(copy.placement_id,'placement');
      for(const [key,field] of [['deadline_rules','anchor_placement_id'],['need_exemptions','placement_id']]){
        for(const [i,l] of s[key].filter(l=>live(l)&&l[field]===copy.source_id).entries()){
          if(l.task_id&&!scopeAncestor(s,ref(l.task_id,'item').activation_scope_id,p.scope_id))routeError('BRANCH_PREPARATION_MAPPING_REQUIRED','Якорь срока требует общей области задачи.',[{type:'item',id:l.task_id}]);
          add(key,p.id+'_'+key+'_'+i,{...l,id:p.id+'_'+key+'_'+i,[field]:p.id});
          if(l.task_id)mark('items',ref(l.task_id,'item'));
        }
      }
      for(const [i,l] of s.time_links.filter(l=>live(l)&&(l.from_placement_id===copy.source_id||l.to_placement_id===copy.source_id)).entries()){
        const map=id=>{if(id===copy.source_id)return p;const source=ref(id,'placement');if(compatibleScopes(s,p.scope_id,source.scope_id))return source;
          const other=s.placements.find(q=>live(q)&&q.item_id===source.item_id&&q.scope_id===p.scope_id);if(!other)routeError('BRANCH_TIME_MAPPING_REQUIRED','Временная связь требует размещения второго пункта в этом варианте.',[{type:'time_link',id:l.id},{type:'item',id:source.item_id},{type:'scope',id:p.scope_id}]);return other;};
        const from=map(l.from_placement_id),to=map(l.to_placement_id);
        if(s.time_links.some(x=>live(x)&&x.from_placement_id===from.id&&x.to_placement_id===to.id))continue;
        const scope=scopePath(s,from.scope_id).filter(x=>scopeAncestor(s,x.id,to.scope_id)).at(-1);
        add('time_links',p.id+'_time_'+i,{...l,id:p.id+'_time_'+i,from_placement_id:from.id,to_placement_id:to.id,scope_id:scope.id});
      }
    }
  }
  function apply(c){
    if(['create_decision','add_option'].includes(c.type)||structural.has(c.type))return;
    if(['edit_option','archive_option','restore_option'].includes(c.type)){
      const o=ref(c.id,'option',c.type==='restore_option');version(o,c,'options',c.type==='restore_option');const d=requireRouteOption(o),scope=optionScope(o);
      if(c.type==='edit_option'){Object.assign(o,c.data);validateOption(o);}
      else {textField(c.reason,'Причина',2000,true);if(c.type==='archive_option'){archive('options',o);archive('scopes',scope);}else{o.archived_at=null;o.archived_by=null;scope.archived_at=null;scope.archived_by=null;mark('scopes',scope);}}
      mark('options',o);mark('decisions',d);mark('items',s.items.find(i=>i.id===d.id));return;
    }
    if(['choose_working','accept_decision','reopen_decision','clear_working'].includes(c.type)){
      const d=ref(c.id,'decision');version(d,c,'decisions');
      if(c.type==='reopen_decision'){textField(c.reason,'Причина пересмотра',2000,true);d.resolution=d.accepted_option_id?'review':'open';reopened.add(d.id);accepted.delete(d.id);}
      else if(c.type==='accept_decision'){if(!decisionActive(s,d))routeError('DECISION_CONTEXT_REQUIRED','Принятие доступно в рабочем родительском варианте.',[{type:'decision',id:d.id}]);if(!d.working_option_id)routeError('WORKING_OPTION_REQUIRED','Сначала выберите рабочий вариант.',[{type:'decision',id:d.id}]);d.accepted_option_id=d.working_option_id;d.resolution='accepted';accepted.add(d.id);}
      else{
        if(d.resolution==='accepted')routeError('REOPEN_REQUIRED','Сначала явно откройте решение для пересмотра.',[{type:'decision',id:d.id}]);
        if(c.type==='choose_working'){const o=ref(c.option_id,'option');if(o.item_id!==d.id)routeError('OPTION_OWNER_MISMATCH','Вариант принадлежит другому решению.');d.working_option_id=o.id;}
        else{
          textField(c.reason,'Причина отсутствия выбора',2000,true);d.working_option_id=null;
          if(c.mode==='retain_placeholder'){
            const data={label:'Уточнить участок маршрута',date_start:null,date_end:null,location_hint:null,...c.data};textField(data.label,'Название участка',300,true);if(data.location_hint!==null)textField(data.location_hint,'Место',500);
            for(const key of ['date_start','date_end'])if(data[key]!==null&&!validDate(data[key]))invalid('INVALID_DATE','Некорректная дата участка.');if(data.date_start&&data.date_end&&data.date_start>data.date_end)invalid('INVALID_DATE_RANGE','Некорректные границы участка.');
            let g=s.decision_gaps.find(g=>live(g)&&g.decision_id===d.id);if(g){Object.assign(g,data);mark('decision_gaps',g);ids[c.key].gap=g.id;}else add('decision_gaps',ids[c.key].gap,{decision_id:d.id,...data});
          }
        }
        if(c.type==='choose_working'||c.mode==='exclude_segment')for(const g of s.decision_gaps.filter(g=>live(g)&&g.decision_id===d.id))archive('decision_gaps',g);
        choiceChanged.add(d.id);
      }
      mark('decisions',d);mark('items',s.items.find(i=>i.id===d.id));return;
    }
    const removing=c.type.startsWith('remove_'),name=c.type.slice(removing?7:4),collection=linkTypes[name];let row;
    if(!removing&&c.expected_version===0)row=add(collection,ids[c.key].link,{});
    else{row=s[collection].find(r=>r.id===reference(c.id,ids,'link'));version(row,c,collection);}
    if(removing){archive(collection,row);return;}
    const values=name==='option_constraint'?{option_id:ref(c.option_id,'option').id,other_option_id:ref(c.other_option_id,'option').id,relation:c.relation}:{[name==='decision_result'?'need_id':'task_id']:ref(c[name==='decision_result'?'need_id':'task_id'],name==='decision_result'?'need':'item').id,decision_id:ref(c.decision_id,'decision').id,required_option_id:c.required_option_id==null?null:ref(c.required_option_id,'option').id};
    if(c.expected_version>0&&Object.keys(values).some(k=>k!=='relation'&&k!=='required_option_id'&&row[k]!==values[k]))invalid('LINK_OWNER_CHANGED','Владельца существующей связи менять нельзя.');Object.assign(row,values);mark(collection,row);
  }
  function finish(commands,dirty){
    validateRouteGraph(s);
    const activeBefore=resolveRoute(before),activeAccepted=activeBefore.decisions.filter(d=>d.active&&d.resolution==='accepted');
    const oldOwner=pid=>{const p=before.placements.find(p=>p.id===pid),item=before.items.find(i=>i.id===p?.item_id);return p&&activePlacement(before,p)?item?.route_owner_decision_id:null;};
    for(const {collection,row} of dirty.values()){
      const original=before[collection]?.find(x=>x.id===row.id);
      if(original&&JSON.stringify(original)===JSON.stringify(row))continue;
      if(collection==='placements'&&original){const omit=new Set(['commitment','approved_context_json','location_state']);const fields=r=>Object.fromEntries(Object.entries(r).filter(([key])=>!omit.has(key)));if(JSON.stringify(fields(original))===JSON.stringify(fields(row)))continue;}
      if(collection==='items'&&original&&original.archived_at!==row.archived_at){if(row.route_owner_decision_id)materialDecisions.add(row.route_owner_decision_id);if(row.decision_mode==='route_segment')materialDecisions.add(row.id);}
      if(collection==='placements'||collection==='placement_places'||collection==='constraints'){
        const owner=oldOwner(collection==='placements'?row.id:row.placement_id);if(owner)materialDecisions.add(owner);
      }
      if(collection==='needs')for(const target of before.need_targets.filter(t=>t.need_id===row.id)){const owner=oldOwner(target.placement_id);if(owner)materialDecisions.add(owner);}
      if(collection==='need_targets'){const owner=oldOwner(row.placement_id);if(owner)materialDecisions.add(owner);const p=s.placements.find(p=>p.id===row.placement_id),item=s.items.find(i=>i.id===p?.item_id);if(activePlacement(s,p)&&item?.route_owner_decision_id)materialDecisions.add(item.route_owner_decision_id);}
      if(['time_links','transition_overrides'].includes(collection))for(const id of [row.from_placement_id,row.to_placement_id]){const owner=oldOwner(id);if(owner)materialDecisions.add(owner);}
      if(collection==='option_constraints')for(const state of [before,s]){const o=state.options.find(o=>o.id===row.option_id),d=(state.decisions||[]).find(d=>d.id===o?.item_id);if(d?.working_option_id===o.id)materialDecisions.add(d.id);}
    }
    // New active placements and direct ownership changes are material too; notes and supplier facts are not.
    for(const p of s.placements.filter(p=>activePlacement(s,p))){const old=before.placements.find(q=>q.id===p.id),item=s.items.find(i=>i.id===p.item_id);if(!activePlacement(before,old)&&item?.route_owner_decision_id)materialDecisions.add(item.route_owner_decision_id);}
    for(const d of activeAccepted)if(materialDecisions.has(d.id)&&!reopened.has(d.id))routeError('REOPEN_REQUIRED','Изменение принятого участка требует явного пересмотра.',[{type:'decision',id:d.id}]);
    for(const d of s.decisions){const item=s.items.find(i=>i.id===d.id),state=d.resolution==='accepted'?'done':'open',selected=d.resolution==='accepted'?d.accepted_option_id:null;
      if(item.state!==state||item.selected_option_id!==selected){item.state=state;item.selected_option_id=selected;item.completed_at=state==='done'?(item.completed_at??now):null;mark('items',item);}
    }
    return {reopened,accepted,choiceChanged};
  }
  return {bootstrap,bindResolved:value=>{resolved=value;},applyStructural,finishStructural,apply,finish,structural};
}
