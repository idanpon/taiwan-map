import {dateLabel} from './planning-model.js';
import { civil } from './trip-timezones.js';

export const entityCollections={item:'items',task:'items',placement:'placements',need:'needs',service:'services',booking:'bookings',decision:'decisions',option:'options',document:'documents',deadline:'deadlines',place:'places',scope:'scopes',constraint:'constraints'};
export const collectionLabels={items:'Запись',placements:'Пункт маршрута',needs:'Потребность',services:'Услуга',bookings:'Бронь',decisions:'Решение',options:'Вариант',documents:'Документ',deadlines:'Срок',scopes:'Участок',placement_places:'Места пункта',service_places:'Места услуги',need_targets:'Назначение потребности',need_tasks:'Задача потребности',need_services:'Обеспечение',need_task_results:'Результат задачи',service_tasks:'Работа с бронью',task_prerequisites:'Зависимость задачи',need_exemptions:'Исключение',deadline_rules:'Правило срока',constraints:'Ограничение времени',time_links:'Временная связь',transition_overrides:'Запас на переход',reschedule_requests:'Запрос переноса',option_constraints:'Условие варианта',decision_gaps:'Неопределённый участок',need_decision_results:'Результат решения',decision_prerequisites:'Зависимость от решения',booking_documents:'Документ брони'};
export const readinessLabels={ready:'Всё готово',not_required:'Подготовка не требуется',needs_review:'Нужна проверка',needs_preparation:'Нужна подготовка',satisfied:'Обеспечено',missing:'Не обеспечено',partial:'Частично обеспечено',unknown:'Нужно уточнить',mismatch:'Условия не совпадают',waived:'Не требуется',retired:'Больше не требуется',dormant:'Вне рабочего варианта'};
export const serviceStateLabels={pending:'Ожидает подтверждения',held:'Временная бронь',confirmed:'Подтверждено',cancelled:'Отменено',used:'Использовано',expired:'Срок истёк',superseded:'Заменено',mixed:'Разные состояния',empty:'Нет услуг'};
export function parseJson(value,fallback={}){try{return typeof value==='string'?JSON.parse(value):value??fallback;}catch{return fallback;}}
export function labelFor(s,type,id){
 const row=s[entityCollections[type]||type]?.find(r=>r.id===id);
 if(!row)return 'Недоступная запись';
 if(type==='placement'||type==='placements')return labelFor(s,'item',row.item_id);
 if(type==='decision'||type==='decisions')return labelFor(s,'item',row.id);
 if(type==='scope'||type==='scopes')return row.option_id?labelFor(s,'option',row.option_id):'Общий маршрут';
 return row.title||row.label||row.name||row.provider_name||row.reason||collectionLabels[entityCollections[type]||type]||'Связь';
}
export function sourceLabels(s){
 const labels={};for(const [collection,rows] of Object.entries(s))if(Array.isArray(rows))for(const row of rows){
  if(!row.id)continue;const label=row.title||row.label||row.name||row.provider_name||row.display_name;
  if(label)labels[row.id]=label;else if(collection==='scopes')labels[row.id]=row.option_id?labelFor(s,'option',row.option_id):'Общий маршрут';else if(collection==='placements')labels[row.id]=labelFor(s,'item',row.item_id);
 }return labels;
}
export function when(value){
 if(!value)return 'Без даты';
 const point=(at,zone)=>{try{const p=civil(Date.parse(at),zone||'Asia/Taipei');return `${dateLabel(p.day)} · ${p.time} · ${zone||'Asia/Taipei'}`;}catch{return at;}};
 if(value.starts_at)return point(value.starts_at,value.start_timezone||value.event_timezone)+(value.ends_at?' → '+point(value.ends_at,value.end_timezone||value.event_timezone):'');
 if(value.at)return point(value.at,value.timezone);
 return [value.local_date||value.date_start,value.date_end].filter((v,i,a)=>v&&(i===0||v!==a[0])).map(dateLabel).join(' → ')||'Без даты';
}
const issueTitles={
 OPTION_COMBINATION_CONFLICT:'Выбранные варианты несовместимы',OPTION_REQUIREMENT_UNRESOLVED:'Сначала требуется выбор в другом решении',ROUTE_SEGMENT_UNRESOLVED:'Участок маршрута пока не определён',GROUP_TIME_INCOMPLETE:'Для группового переноса нужно уточнить время',GROUP_ORDER_AMBIGUOUS:'Неясен порядок одновременных пунктов',GROUP_ORDER_INCOMPLETE:'Не хватает времени для определения порядка',GROUP_TRANSITION_UNRESOLVED:'Сначала уточните длительный переезд',GROUP_FIXED_ANCHOR:'Начало переноса связано с фиксированным билетом',GROUP_ROUTE_GAP:'Перенос достиг неопределённого участка',GROUP_DIRECTION_MISMATCH:'Направление не соответствует новому времени',SERVICE_NOT_USED_BY_PLAN:'Услуга пока не используется в рабочем маршруте',SERVICE_OVERALLOCATED:'Общее распределение превышает количество в билете',SERVICE_USE_LIMIT_EXCEEDED:'Превышено число использований билета',SERVICE_USE_LIMIT_UNKNOWN:'Уточните число использований билета',HOLD_EXPIRY_UNKNOWN:'У временной брони не указан срок действия',UNSUPPORTED_NESTING:'Поддерживается только один уровень вложенных решений',
 SCHEDULE_OVERLAP:'Пункты пересекаются по времени',STAY_NIGHT_OVERLAP:'Проживания пересекаются по ночам',PIN_MISMATCH:'Время не совпадает с билетом или закреплением',WINDOW_VIOLATION:'Пункт выходит за допустимое время',DURATION_VIOLATION:'Длительность не соответствует условиям',TIME_CONSTRAINT_UNKNOWN:'Для проверки закрепления не хватает времени',TIME_INCOMPLETE:'Время пункта задано не полностью',TRANSITION_ESTIMATE:'Запас рассчитан по прямой дистанции — проверьте маршрут',DISTANCE_UNKNOWN_DEFAULT:'Расстояние неизвестно: по умолчанию 15 минут',LONG_TRANSFER_REVIEW:'Больше 100 км: время переезда нужно уточнить',DISTANCE_INCOMPLETE:'Не все точки определены',TRANSITION_OVERRIDE_CONFLICT:'Указаны несовместимые запасы на переход',TRANSITION_OVERRIDE_STALE:'Точки изменились: проверьте запас заново',TRANSITION_CONDITION_SHORT:'Не хватает времени с учётом условий билета',TRANSITION_BUFFER_SHORT:'Между пунктами недостаточно запаса',TIME_LINK_INCOMPLETE:'Для временной зависимости не хватает данных',TIME_LINK_VIOLATION:'Нарушена временная зависимость',GROUP_FIXED_BOUNDARY:'Дальше стоит пункт с закреплённым временем',GROUP_SCOPE_BOUNDARY:'Перенос достиг границы варианта',GROUP_TIME_UNKNOWN:'Для группового переноса нужно уточнить время',GROUP_OVERLAP:'Пункты группы пересекаются',ROUTE_BOOKING_IMPACT:'Рабочий вариант меняется, реальная бронь сохраняется',BOOKING_BINDING_RELEASED:'Билет или бронь остаётся без прежнего назначения',NEED_MISSING:'Потребность не обеспечена',NEED_PARTIAL:'Потребность обеспечена частично',NEED_UNKNOWN:'Готовность требует уточнения',NEED_MISMATCH:'Условия брони не подходят пункту',TARGET_AFTER_SUPPLIER_DEADLINE:'Целевая дата позже внешнего срока',COMPLETED_TASK_PREREQUISITE_CHANGED:'Изменились условия выполненной задачи',OPTION_REQUIRES_OPTION:'Для варианта требуется другой выбранный вариант',OPTION_EXCLUDES_OPTION:'Варианты несовместимы',ROUTE_GAP:'Участок пока не определён',MULTIPLE_PLACEMENT_OWNERS:'Один пункт нельзя независимо менять двумя решениями',NESTING_LIMIT:'Более глубокая вложенность решений не поддерживается',BRANCH_PREPARATION_MAPPING_REQUIRED:'Нужно явно распределить подготовку между вариантами',COPY_NESTED_DECISION_UNSUPPORTED:'Вложенное решение нужно добавить явно'};
export function issueText(issue){
 const v=issue.values||{},title=issueTitles[issue.code]||issue.message||'Требуется проверка связи';
 const facts=[];
 if(v.shortfall_minutes!=null)facts.push(`не хватает ${Math.ceil(v.shortfall_minutes)} мин`);
 if(v.required_minutes!=null)facts.push(`нужно ${v.required_minutes} мин`);
 if(v.overlap_minutes!=null)facts.push(`пересечение ${Math.ceil(v.overlap_minutes)} мин`);
 if(v.distance_m!=null)facts.push(`${(v.distance_m/1000).toLocaleString('ru',{maximumFractionDigits:1})} км по прямой`);
 if(v.lost_nights?.length)facts.push('не используются ночи: '+v.lost_nights.join(', '));
 return title+(facts.length?' · '+facts.join(' · '):'');
}
export function issueRefs(issue){
 if(Array.isArray(issue.refs))return issue.refs;
 return Object.entries(issue.refs||{}).flatMap(([key,id])=>key.endsWith('_id')&&typeof id==='string'?[{type:key.slice(0,-3),id}]:[]);
}
const technical=new Set(['id','trip_id','created_at','created_by','updated_at','updated_by','archived_by','version','approved_context_json','context_hash','place_match_context_hash','decision_mode']);
export function presentChanges(changes,s){
 const projected=new Set(changes.filter(c=>c.collection==='placements').map(c=>(c.after||c.before).item_id));
 return changes.map(c=>{
  const display=row=>row?Object.fromEntries(Object.entries(row).filter(([key])=>!technical.has(key)&&!(c.collection==='items'&&projected.has(c.id)&&['date_start','date_end','starts_at','ends_at','event_timezone','fixed_external','sort_order'].includes(key)))):null;
  const before=display(c.before),after=display(c.after);
  const fields=[...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(k=>JSON.stringify(before?.[k])!==JSON.stringify(after?.[k]));
  return {entity:c.collection,id:c.id,name:labelFor({...s,[c.collection]:[...(s[c.collection]||[]).filter(r=>r.id!==c.id),c.after||c.before]},c.collection,c.id),action:c.before?'update':'create',fields,before,after};
 }).filter(c=>c.fields.length);
}
