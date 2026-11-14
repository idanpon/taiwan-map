// The same choice tree drives schedule, coverage, compatibility reads and reminders.
import { PlanningDomainError, closed, validId } from './planning-domain-common.js';

const live=r=>r&&r.archived_at==null;
export function routeError(code,message,refs=[]){const e=new PlanningDomainError(code,message);e.refs=refs;throw e;}
export const routeIssue=(code,refs,values={},sources=[],blocking=false)=>({code,refs,values,sources,severity:blocking?'error':'warning',blocking,key:JSON.stringify({code,refs,values,sources})});
export function scopePath(s,id){
  const path=[],seen=new Set();let scope=s.scopes.find(x=>x.id===id);
  while(scope){if(seen.has(scope.id))routeError('SCOPE_CYCLE','Области образуют цикл.',path.map(x=>({type:'scope',id:x.id})));seen.add(scope.id);path.push(scope);scope=s.scopes.find(x=>x.id===scope.parent_scope_id);}
  return path.reverse();
}
export const scopeAncestor=(s,ancestor,id)=>scopePath(s,id).some(x=>x.id===ancestor);
export function scopeActive(s,id){
  const path=scopePath(s,id);if(!path.length||path[0].parent_scope_id)return false;
  return path.every(scope=>{
    if(!live(scope))return false;if(!scope.parent_scope_id)return true;
    const option=s.options.find(o=>o.id===scope.option_id),d=(s.decisions||[]).find(d=>d.id===option?.item_id),item=s.items.find(i=>i.id===d?.id);
    return live(option)&&live(d)&&live(item)&&item.state!=='cancelled'&&d.scope_id===scope.parent_scope_id&&d.working_option_id===option.id;
  });
}
export const decisionActive=(s,d)=>live(d)&&s.items.some(i=>i.id===d.id&&live(i)&&i.state!=='cancelled')&&scopeActive(s,d.scope_id);
export function compatibleScopes(s,a,b){
  const choices=new Map();for(const scope of [...scopePath(s,a),...scopePath(s,b)])if(scope.option_id){const o=s.options.find(o=>o.id===scope.option_id);if(!o)return false;if(choices.has(o.item_id)&&choices.get(o.item_id)!==o.id)return false;choices.set(o.item_id,o.id);}return true;
}
export function optionIssues(s,optionId){
  const issues=[];
  for(const c of (s.option_constraints||[]).filter(c=>live(c)&&c.option_id===optionId)){
    const target=s.options.find(o=>o.id===c.other_option_id),d=(s.decisions||[]).find(d=>d.id===target?.item_id),active=decisionActive(s,d);
    const current=active?d.working_option_id:null,match=live(target)&&current===target.id;
    if(c.relation==='requires_option'&&!match||c.relation==='excludes_option'&&match){
      const unresolved=c.relation==='requires_option'&&(!active||!current);
      issues.push(routeIssue(unresolved?'OPTION_REQUIREMENT_UNRESOLVED':'OPTION_COMBINATION_CONFLICT',[{type:'option',id:optionId},{type:'option',id:c.other_option_id}],{relation:c.relation,target_decision_id:d?.id??null,actual_option_id:current},[{type:'option_constraint',id:c.id,version:c.version}]));
    }
  }
  return issues;
}
export function decisionSatisfied(s,id,requiredOption=null){
  const d=(s.decisions||[]).find(d=>d.id===id);
  return decisionActive(s,d)&&d.resolution==='accepted'&&d.accepted_option_id===d.working_option_id&&Boolean(d.working_option_id)&&(!requiredOption||d.working_option_id===requiredOption)&&!optionIssues(s,d.working_option_id).length;
}
export function resolveRoute(s){
  const issues=[],scopeIds=s.scopes.filter(x=>scopeActive(s,x.id)).map(x=>x.id),decisions=[];
  for(const d of (s.decisions||[]).filter(live)){
    const active=decisionActive(s,d),own=active&&d.working_option_id?optionIssues(s,d.working_option_id):[];issues.push(...own);
    decisions.push({...d,active,requires_review:d.resolution==='accepted'&&(d.working_option_id!==d.accepted_option_id||own.length>0),option_ids:s.options.filter(o=>live(o)&&o.item_id===d.id).map(o=>o.id)});
  }
  const gaps=(s.decision_gaps||[]).filter(g=>live(g)&&decisions.some(d=>d.id===g.decision_id&&d.active&&!d.working_option_id));
  for(const g of gaps)issues.push(routeIssue('ROUTE_SEGMENT_UNRESOLVED',[{type:'decision',id:g.decision_id},{type:'gap',id:g.id}],{date_start:g.date_start,date_end:g.date_end},[{type:'gap',id:g.id,version:g.version}]));
  return {scope_ids:scopeIds,decisions,gaps,issues,choices:decisions.map(d=>({decision_id:d.id,working_option_id:d.working_option_id,accepted_option_id:d.accepted_option_id,resolution:d.resolution,active:d.active})),complete:!gaps.length&&!issues.length};
}
export function comparisonSources(s,choices){
  if(!Array.isArray(choices)||!choices.length||choices.length>20)routeError('INVALID_COMPARISON','Нужно от 1 до 20 явных выборов.');
  const copy=structuredClone(s),seen=new Set();
  for(const choice of choices){
    closed(choice,['decision_id','option_id']);if(!validId(choice.decision_id)||choice.option_id!==null&&!validId(choice.option_id)||seen.has(choice.decision_id))routeError('INVALID_COMPARISON','Выборы должны содержать разные решения и корректные ID.');seen.add(choice.decision_id);
    const d=(copy.decisions||[]).find(d=>d.id===choice.decision_id);if(!live(d)||!copy.items.some(i=>live(i)&&i.id===d.id))routeError('TARGET_UNAVAILABLE','Решение недоступно.');
    if(choice.option_id!==null&&!copy.options.some(o=>live(o)&&o.id===choice.option_id&&o.item_id===d.id))routeError('OPTION_OWNER_MISMATCH','Вариант не принадлежит этому решению.');
    d.working_option_id=choice.option_id;
    if(choice.option_id===null&&!copy.decision_gaps.some(g=>live(g)&&g.decision_id===d.id))copy.decision_gaps.push({id:'comparison-gap-'+d.id,decision_id:d.id,label:'Уточнить участок маршрута',date_start:null,date_end:null,location_hint:null,version:1,archived_at:null});
  }
  return copy;
}
