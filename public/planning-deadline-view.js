import { deadlineProjection } from './planning-targets.js';
import { live, taskApplicable,serviceState } from './planning-readiness.js';

export const deadlineLabels = Object.freeze({target:'Целевой срок',sales_open:'Открытие продаж',sales_close:'Окончание продаж',payment:'Оплата',cancel_by:'Отмена без штрафа',check_in:'Регистрация'});

// Supplier deadlines remain relevant outside the working route. No title matching.
export function deadlineTarget(s, id, projection = deadlineProjection(s),now=Date.now()) {
  const deadline=s.deadlines.find(d=>d.id===id);
  if(!deadline)return null;
  const value=projection.find(d=>d.id===id),task=s.items.find(i=>i.id===deadline.task_id),service=s.services.find(i=>i.id===deadline.service_id);
  const applicable=live(deadline)&&Boolean(value?.complete)&&
    (task?live(task)&&['open','in_progress'].includes(task.state)&&taskApplicable(s,task):
      live(service)&&['pending','held','confirmed'].includes(serviceState(service,now)));
  return {id:deadline.id,deadline_id:deadline.id,version:deadline.version,kind:'deadline',
    title:`${deadlineLabels[deadline.kind]||'Срок'} · ${task?.title||service?.title||'Недоступная запись'}`,
    state:applicable?'open':'cancelled',_applicable:applicable,
    starts_at:value?.at||null,ends_at:null,date_start:value?.local_date||null,date_end:null,
    event_timezone:deadline.timezone,_reminder_timezone:deadline.timezone,
    task_id:deadline.task_id,service_id:deadline.service_id,booking_id:service?.booking_id||null};
}
