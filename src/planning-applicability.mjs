import { readSources, planningModel } from './planning-domain-store.mjs';
import { taskApplicable, activePlacement } from '../public/planning-readiness.js';
import {scopeActive} from '../public/planning-scopes.js';

export function applicablePlanningIds(db){
  if(planningModel(db)!==3)return null;
  const {sources:s}=readSources(db);
  return new Set(s.items.filter(i=>i.kind==='task'?taskApplicable(s,i):i.kind==='decision'?i.archived_at==null&&scopeActive(s,i.activation_scope_id):i.archived_at==null&&s.placements.some(p=>p.item_id===i.id&&activePlacement(s,p))).map(i=>i.id));
}
