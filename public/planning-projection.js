import { derivePreparation } from './planning-readiness.js';
import { deadlineProjection } from './planning-targets.js';
import { deriveSchedule } from './planning-schedule.js';
import { resolveRoute } from './planning-scopes.js';

export function derivePlanning(s,now){
  const deadlines=deadlineProjection(s),view={...s,deadlines:s.deadlines.map(d=>{const p=deadlines.find(x=>x.id===d.id);return p&&d.mode==='relative'?{...d,at:p.at,local_date:p.local_date}:d;})};
  const derived=derivePreparation(view,now);
  derived.deadlines=deadlines;derived.schedule=deriveSchedule(view,now);
  derived.route=resolveRoute(s);derived.completeness.route_options='supported';
  derived.completeness.schedule='supported';
  derived.issues.push(...derived.schedule.issues,...derived.route.issues);
  return derived;
}
