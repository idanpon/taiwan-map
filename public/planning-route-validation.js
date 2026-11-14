import { routeError, scopePath, scopeAncestor, compatibleScopes } from './planning-scopes.js';

const live=r=>r&&r.archived_at==null,ref=(type,id)=>({type,id});
export function validateRouteGraph(s){
  if((s.decisions||[]).length>100||s.options.length>500||s.placements.length>3000)routeError('ROUTE_LIMIT','Достигнут предел 100 решений, 500 вариантов или 3000 размещений.');
  const get=(key,id)=>{const r=(s[key]||[]).find(r=>r.id===id);if(!r)routeError('TARGET_UNAVAILABLE','Связанный объект не найден.',[ref(key,id)]);return r;};
  const roots=s.scopes.filter(x=>live(x)&&!x.parent_scope_id);if(roots.length!==1)routeError('INVALID_ROOT_SCOPE','Нужна одна корневая область.');
  for(const scope of s.scopes){
    const path=scopePath(s,scope.id);if(path[0].id!==roots[0].id)routeError('INVALID_SCOPE_TREE','Область не связана с корнем.',[ref('scope',scope.id)]);
    if(path.length>3)routeError('UNSUPPORTED_NESTING','Поддерживаются внешний выбор и один вложенный уровень.',path.map(x=>ref('scope',x.id)));
    if(scope.parent_scope_id){const o=get('options',scope.option_id),d=get('decisions',o.item_id);if(d.scope_id!==scope.parent_scope_id)routeError('INVALID_SCOPE_PARENT','Родитель варианта должен совпадать с областью решения.',[ref('scope',scope.id),ref('decision',d.id)]);}
  }
  for(const d of s.decisions||[]){
    const item=get('items',d.id);if(item.kind!=='decision'||item.decision_mode!=='route_segment'||item.activation_scope_id!==d.scope_id)routeError('INVALID_ROUTE_DECISION','Решение и его область не согласованы.',[ref('decision',d.id)]);
    get('scopes',d.scope_id);
    if(scopePath(s,d.scope_id).length>2)routeError('UNSUPPORTED_NESTING','Поддерживаются внешний выбор и один вложенный уровень.',[{type:'decision',id:d.id},...scopePath(s,d.scope_id).map(x=>ref('scope',x.id))]);
    for(const id of [d.working_option_id,d.accepted_option_id].filter(Boolean)){const o=get('options',id);if(o.item_id!==d.id)routeError('OPTION_OWNER_MISMATCH','Выбран чужой вариант.',[ref('decision',d.id),ref('option',id)]);}
    if(live(d)&&d.working_option_id&&!live(get('options',d.working_option_id)))routeError('WORKING_OPTION_ARCHIVED','Перед архивированием выберите другой вариант или явно очистите выбор.',[ref('decision',d.id),ref('option',d.working_option_id)]);
    if(d.resolution==='accepted'&&(!d.working_option_id||d.working_option_id!==d.accepted_option_id))routeError('ACCEPTED_CHOICE_MISMATCH','Принятый выбор требует пересмотра.',[ref('decision',d.id)]);
  }
  for(const option of s.options.filter(o=>s.items.some(i=>i.id===o.item_id&&i.decision_mode==='route_segment'))){
    get('decisions',option.item_id);const scopes=s.scopes.filter(x=>x.option_id===option.id);
    if(scopes.length!==1||Boolean(live(option))!==Boolean(live(scopes[0])))routeError('OPTION_SCOPE_MISMATCH','Вариант должен иметь одну согласованную область.',[ref('option',option.id)]);
  }
  for(const item of s.items){
    if(!item.activation_scope_id)continue;get('scopes',item.activation_scope_id);
    const placements=s.placements.filter(p=>live(p)&&p.item_id===item.id),seen=new Set();
    if(!['visit','stay','transport'].includes(item.kind)){if(placements.length)routeError('INVALID_PLACEMENT_KIND','Только маршрутный пункт имеет размещения.',[ref('item',item.id)]);continue;}
    const owner=item.route_owner_decision_id?get('decisions',item.route_owner_decision_id):null;
    if(owner&&item.activation_scope_id!==owner.scope_id)routeError('MULTIPLE_PLACEMENT_OWNERS','Область пункта должна принадлежать его единственному решению.',[ref('item',item.id),ref('decision',owner.id)]);
    if(!owner&&placements.length>1)routeError('MULTIPLE_PLACEMENT_OWNERS','Несколько размещений требуют одного владельца.',[ref('item',item.id)]);
    for(const p of placements){
      const scope=get('scopes',p.scope_id),option=scope.option_id?get('options',scope.option_id):null;
      if(seen.has(p.scope_id)||(owner?option?.item_id!==owner.id:scope.id!==item.activation_scope_id))routeError('MULTIPLE_PLACEMENT_OWNERS','Два решения не могут независимо задавать размещение одного пункта.',[ref('item',item.id),ref('placement',p.id),...(owner?[ref('decision',owner.id)]:[])]);
      seen.add(p.scope_id);
    }
  }
  for(const n of s.needs.filter(live)){
    get('scopes',n.scope_id);
    for(const link of s.need_targets.filter(l=>live(l)&&l.need_id===n.id)){const p=get('placements',link.placement_id);if(!scopeAncestor(s,n.scope_id,p.scope_id))routeError('NEED_SCOPE_UNREACHABLE','Потребность должна быть в общей области своих назначений.',[ref('need',n.id),ref('placement',p.id)]);}
  }
  for(const key of ['need_tasks','need_task_results'])for(const l of s[key].filter(live)){
    const task=get('items',l.task_id),need=get('needs',l.need_id);if(!scopeAncestor(s,task.activation_scope_id,need.scope_id))routeError('TASK_SCOPE_UNREACHABLE','Общая подготовка должна находиться в общей родительской области.',[ref('item',task.id),ref('need',need.id)]);
  }
  for(const r of (s.deadline_rules||[]).filter(live)){const task=get('items',r.task_id),p=get('placements',r.anchor_placement_id);if(!scopeAncestor(s,task.activation_scope_id,p.scope_id))routeError('TASK_SCOPE_UNREACHABLE','Якорь срока недоступен задаче из её области.',[ref('item',task.id),ref('placement',p.id)]);}
  for(const l of (s.time_links||[]).filter(live)){const a=get('placements',l.from_placement_id),b=get('placements',l.to_placement_id);if(!compatibleScopes(s,a.scope_id,b.scope_id)||!scopeAncestor(s,l.scope_id,a.scope_id)||!scopeAncestor(s,l.scope_id,b.scope_id))routeError('TIME_LINK_SCOPE_CONFLICT','Временная связь требует совместимых пунктов и общей области.',[ref('placement',a.id),ref('placement',b.id),ref('time_link',l.id)]);}
  for(const key of ['need_decision_results','decision_prerequisites']){
    const pairs=new Set();for(const l of (s[key]||[]).filter(live)){
      const d=get('decisions',l.decision_id),owner=key==='need_decision_results'?get('needs',l.need_id):get('items',l.task_id),scope=owner.scope_id||owner.activation_scope_id;
      if(key==='need_decision_results'?owner.kind!=='decision_result':owner.kind!=='task')routeError('INVALID_DECISION_RESULT','Неверный тип владельца результата/условия.');
      if(l.required_option_id&&get('options',l.required_option_id).item_id!==d.id)routeError('OPTION_OWNER_MISMATCH','Условие ссылается на вариант другого решения.');
      const requiredScope=l.required_option_id?s.scopes.find(x=>x.option_id===l.required_option_id).id:d.scope_id;
      if(!compatibleScopes(s,scope,requiredScope))routeError('PREREQUISITE_SCOPE_CONFLICT','Условие решения и его потребитель принадлежат несовместимым ветвям.',[ref('decision',d.id),ref('scope',scope)]);
      const pair=owner.id+':'+d.id;if(pairs.has(pair))routeError('DUPLICATE_LINK','Условие решения уже задано.');pairs.add(pair);
    }
  }
  const pairs=new Map(),edges=[];
  for(const c of (s.option_constraints||[]).filter(live)){
    const a=get('options',c.option_id),b=get('options',c.other_option_id),da=get('decisions',a.item_id),db=get('decisions',b.item_id);
    if(a.item_id===b.item_id)routeError('OPTION_SELF_CONDITION','Условие должно ссылаться на другое решение.',[ref('option',a.id),ref('option',b.id)]);
    const pair=a.id+':'+b.id;if(pairs.has(pair))routeError('CONTRADICTORY_OPTION_CONDITION','Повторяющиеся или противоположные условия одной пары не поддерживаются.',[ref('option',a.id),ref('option',b.id)]);pairs.set(pair,c.relation);
    if(c.relation==='requires_option'){
      const sa=s.scopes.find(x=>x.option_id===a.id),sb=s.scopes.find(x=>x.option_id===b.id);
      if(!compatibleScopes(s,sa.id,sb.id))routeError('OPTION_PARENT_CONFLICT','Родительские варианты делают это требование невозможным.',[ref('option',a.id),ref('option',b.id)]);
      edges.push([da.id,db.id]);
    }
  }
  for(const l of s.task_prerequisites.filter(live)){const a=get('items',l.task_id),b=get('items',l.required_task_id);if(!compatibleScopes(s,a.activation_scope_id,b.activation_scope_id))routeError('PREREQUISITE_SCOPE_CONFLICT','Обязательные задачи находятся в несовместимых ветвях.',[ref('item',a.id),ref('item',b.id)]);edges.push([a.id,b.id]);}
  for(const l of (s.decision_prerequisites||[]).filter(live))edges.push([l.task_id,l.decision_id]);
  const done=new Set(),visiting=[];
  const walk=id=>{if(visiting.includes(id))routeError([...visiting,id].every(id=>s.items.find(i=>i.id===id)?.kind==='task')?'TASK_DEPENDENCY_CYCLE':'DEPENDENCY_CYCLE','Обязательные условия образуют цикл.',[...visiting,id].map(id=>ref('item',id)));if(done.has(id))return;visiting.push(id);for(const [a,b] of edges)if(a===id)walk(b);visiting.pop();done.add(id);};
  for(const [a] of edges)walk(a);
}
