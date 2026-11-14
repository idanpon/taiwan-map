import { validDate, dayInZone } from './planning-model.js';
import { PlanningDomainError, invalid, object, closed, validId, reference, checkVersion, textField, validateIdentity, zoneValid } from './planning-domain-common.js';
import { derivePlanning } from './planning-projection.js';
import { approvalContext, placementConstraints } from './planning-schedule.js';
import { transitionContext } from './planning-transitions.js';
import { scheduleFields, validateScheduleCommand, scheduleContext, scheduleOutcome } from './planning-schedule-commands.js';
import { preparationFields, validatePreparationCommand, preparationContext } from './planning-preparation.js';
import { routeFields, validateRouteCommand, routeContext } from './planning-route-commands.js';
import { validateRouteGraph } from './planning-route-validation.js';
import { activePlacement } from './planning-readiness.js';
import { routeOutcome } from './planning-route-effects.js';
import { documentFields, validateDocumentCommand, documentContext } from './planning-documents.js';
export { PlanningDomainError, validId } from './planning-domain-common.js';

export const foundationCapabilities = Object.freeze({
  placements: true, stable_links: true, changesets: true,
  requirements: true, bookings: true, preparation: true, route_options: true, documents: true,
  route_completion: true, deadline_reminders: true, time_constraints: true, distance_buffer: true, group_shift: true, approved_slots: true,
});
const identityFields = ['title', 'description', 'note', 'priority', 'assignee_id'];
const placementFields = ['date_start', 'date_end', 'starts_at', 'ends_at', 'start_timezone', 'end_timezone', 'precision', 'part_of_day', 'intended_duration_minutes', 'order_key'];
const commandFields = {
  create_item: ['id', 'scope_id', 'data'], edit_item: ['id', 'expected_version', 'data'],
  upsert_placement: ['id', 'expected_version', 'data'],
  link_place: ['id', 'placement_id', 'expected_version', 'data'],
  unlink_place: ['id', 'expected_version'],
  ...preparationFields, ...scheduleFields, ...routeFields, ...documentFields,
};
export const planningCommandFields=Object.freeze(commandFields);
export function normalizeCommands(input) {
  if (!Array.isArray(input) || !input.length || input.length > 100)
    invalid('INVALID_COMMANDS', 'Пакет должен содержать от 1 до 100 команд.', 400);
  const keys = new Set();
  for (const command of input) {
    if (!object(command) || !Object.hasOwn(commandFields, command.type))
      invalid('UNSUPPORTED_COMMAND', 'Эта операция пока не поддерживается новой моделью.', 422);
    closed(command, ['key', 'type', ...commandFields[command.type]]);
    if (typeof command.key !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(command.key) || ['__proto__','constructor','prototype'].includes(command.key) || keys.has(command.key))
      invalid('INVALID_COMMAND_KEY', 'Нужны уникальные ключи команд.', 400);
    keys.add(command.key);
    if (Object.hasOwn(documentFields,command.type)) { validateDocumentCommand(command); continue; }
    if (Object.hasOwn(routeFields,command.type)) { validateRouteCommand(command); continue; }
    if (Object.hasOwn(scheduleFields,command.type)) { validateScheduleCommand(command); continue; }
    if (Object.hasOwn(preparationFields,command.type)) { validatePreparationCommand(command); continue; }
    if (command.type === 'create_item') {closed(command.data, ['kind', ...identityFields]);if(!['task','visit','stay','transport'].includes(command.data.kind))invalid('UNSUPPORTED_KIND','Решение создаётся командой create_decision.');}
    if (command.type === 'edit_item') closed(command.data, identityFields);
    if (command.type === 'upsert_placement') closed(command.data, placementFields);
    if (command.type === 'link_place') closed(command.data, ['place_id', 'role', 'selection', 'label_snapshot', 'sort_order']);
    if (command.type !== 'create_item' && command.type !== 'link_place' && (!Number.isSafeInteger(command.expected_version) || command.expected_version < 1))
      invalid('EXPECTED_VERSION_REQUIRED', 'Укажите ожидаемую версию.', 400);
    if (command.type === 'link_place' && (!Number.isSafeInteger(command.expected_version) || command.expected_version < 0))
      invalid('EXPECTED_VERSION_REQUIRED', 'Для новой связи укажите версию 0.', 400);
  }
  return structuredClone(input);
}
function validatePlacement(p, item) {
  if (!['unscheduled', 'day', 'part_of_day', 'approximate', 'exact'].includes(p.precision)) invalid('INVALID_PRECISION', 'Укажите точность времени.');
  for (const key of ['date_start', 'date_end']) if (p[key] !== null && !validDate(p[key])) invalid('INVALID_DATE', 'Некорректная дата.');
  for (const key of ['starts_at', 'ends_at']) if (p[key] !== null) {
    if (typeof p[key] !== 'string' || !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/.test(p[key]) || !validDate(p[key].slice(0,10)) || !Number.isFinite(Date.parse(p[key])))
      invalid('INVALID_INSTANT', 'Укажите корректный момент в UTC.');
  }
  if (!Number.isSafeInteger(p.order_key) || Math.abs(p.order_key) > 1000000) invalid('INVALID_ORDER', 'Некорректный порядок.');
  if (p.intended_duration_minutes !== null && (!Number.isSafeInteger(p.intended_duration_minutes) || p.intended_duration_minutes <= 0))
    invalid('INVALID_DURATION', 'Длительность должна быть положительным целым числом минут.');
  for (const key of ['start_timezone', 'end_timezone']) if (p[key] !== null && !zoneValid(p[key])) invalid('INVALID_TIMEZONE', 'Некорректный часовой пояс.');
  if (p.precision === 'unscheduled' && [p.date_start,p.date_end,p.starts_at,p.ends_at,p.part_of_day].some(v => v !== null))
    invalid('UNSCHEDULED_WITH_TIME', 'У нераспределённого пункта нет дат и времени.');
  if (['day','part_of_day'].includes(p.precision) && (!(p.date_start || p.date_end) || p.starts_at || p.ends_at))
    invalid('DAY_WITH_INSTANT', 'Для этого режима нужны только календарные даты.');
  if ((p.precision === 'part_of_day') !== (p.part_of_day !== null) || (p.part_of_day !== null && !['morning','afternoon','evening','night'].includes(p.part_of_day)))
    invalid('INVALID_PART_OF_DAY', 'Проверьте часть дня.');
  if (p.precision === 'exact' && (!p.starts_at || !p.ends_at || Date.parse(p.starts_at) >= Date.parse(p.ends_at)))
    invalid('INVALID_INTERVAL', 'Для точного интервала нужны начало и окончание.');
  if (p.precision === 'approximate' && ![p.starts_at,p.ends_at,p.date_start,p.date_end].some(Boolean))
    invalid('EMPTY_APPROXIMATE', 'Укажите известные границы приблизительного времени.');
  for (const [at,date,tz] of [['starts_at','date_start','start_timezone'],['ends_at','date_end','end_timezone']]) {
    if (p[at] && (!p[tz] || p[date] !== dayInZone(p[at],p[tz]))) invalid('LOCAL_DATE_MISMATCH', 'Местная дата не соответствует моменту и часовому поясу.');
  }
  if (p.starts_at && p.ends_at) {
    if (Date.parse(p.starts_at) >= Date.parse(p.ends_at)) invalid('INVALID_INTERVAL', 'Окончание должно быть позже начала.');
    if (p.intended_duration_minutes !== null && Date.parse(p.ends_at)-Date.parse(p.starts_at) !== p.intended_duration_minutes*60000)
      invalid('DURATION_MISMATCH', 'Длительность не совпадает с интервалом.');
  }
  if (item.kind !== 'transport' && p.date_start && p.date_end && p.date_start > p.date_end) invalid('INVALID_DATE_RANGE', 'Нарушен порядок дат.');
  if (item.kind === 'stay' && p.precision !== 'unscheduled' && (!p.date_start || !p.date_end || p.date_start >= p.date_end))
    invalid('INVALID_STAY_RANGE', 'Для жилья нужны даты заселения и выезда.');
}
function assertEditablePlacement(original, item, sources, now) {
  if(!item||item.archived_at!=null)invalid('TARGET_UNAVAILABLE','Пункт недоступен.',404);
  if (!original) return;
  if (item.state === 'done' || item.state === 'cancelled')
    invalid('ADVANCED_CHANGE_REQUIRED', 'Выполненный пункт требует отдельного изменения.');
}

// Pure final-graph evaluation shared by preview and apply. No persistence/clock/AI.
export function evaluateFoundation(snapshot, input, ids, { actorId, now, assets=[] }) {
  const commands = normalizeCommands(input), sources = structuredClone(snapshot.sources);
  const root = sources.scopes.find(s => !s.parent_scope_id && s.archived_at == null);
  if (!root) invalid('ROOT_SCOPE_MISSING', 'Корневая область поездки не найдена.');
  const before = snapshot.sources, dirty = new Map(), touched = new Set(), seen = new Set();
  const audit = { version: 1, created_at: now, updated_at: now, created_by: actorId, updated_by: actorId, archived_at: null, archived_by: null };
  function mark(kind, row) {
    const key = kind + ':' + row.id;
    dirty.set(key, { collection: kind, row });
  }
  function uniqueTarget(kind, id) {
    const key=kind+':'+id;
    if (seen.has(key)) invalid('DUPLICATE_TARGET', 'Объедините изменения одной записи в одну команду.');
    seen.add(key);
  }
  function createItem(id,placementId,data,scopeId=root.id) {
    if (sources.items.length >= 1000) invalid('ITEM_LIMIT', 'Достигнут лимит 1000 записей.');
    if (!validId(id) || sources.items.some(i => i.id === id)) invalid('ID_CONFLICT', 'ID новой записи уже занят.',409);
    if (!['task','decision','visit','stay','transport'].includes(data.kind)) invalid('UNSUPPORTED_KIND', 'Неизвестный тип пункта.');
    const item = { id, trip_id: snapshot.trip.id, kind: data.kind, title: '', description: '', note: '', priority: 'normal', assignee_id: null,
      state: 'open', completed_at: null, date_start: null, date_end: null, starts_at: null, ends_at: null,
      event_timezone: snapshot.trip.timezone, sort_order: 0, fixed_external: 0, source_urls: '[]', selected_option_id: null,
      transport_json: data.kind === 'transport' ? JSON.stringify({mode:'other',arrival_timezone:snapshot.trip.timezone,service_number:'',departure_details:'',arrival_details:'',stops:[]}) : null,
      activation_scope_id: scopeId, route_owner_decision_id: null, decision_mode: null,
      task_activation: data.kind === 'task' ? 'independent' : null, completion_placement_id: null, completion_snapshot_json: null, ...audit, ...data };
    validateIdentity(item,sources); sources.items.push(item); mark('items',item); touched.add(id);
    if (['visit','stay','transport'].includes(item.kind)) {
      const scope=sources.scopes.find(x=>x.id===scopeId);if(!scope||scope.archived_at!=null)invalid('TARGET_UNAVAILABLE','Область пункта недоступна.',404);
      if(scope.option_id){item.route_owner_decision_id=sources.options.find(o=>o.id===scope.option_id).item_id;item.activation_scope_id=scope.parent_scope_id;}
      const p = { id: placementId, trip_id:snapshot.trip.id, item_id:id, scope_id:scopeId,
        participation:'included',commitment:'tentative',precision:'unscheduled',date_start:null,date_end:null,starts_at:null,ends_at:null,
        start_timezone:null,end_timezone:null,part_of_day:null,intended_duration_minutes:null,order_key:0,location_state:'unspecified',approved_context_json:null,...audit };
      sources.placements.push(p);mark('placements',p);
    }
    return item;
  }
  const routes=routeContext({sources,before,ids,root,audit,mark,now,actorId,trip:snapshot.trip,createItem});
  routes.bootstrap(commands);
  for (const c of commands.filter(c=>c.type==='create_item')) createItem(ids[c.key]?.item,ids[c.key]?.placement,c.data,c.scope_id?reference(c.scope_id,ids,'scope'):root.id);
  const prep=preparationContext({sources,before,ids,root,audit,mark,now,actorId,trip:snapshot.trip,createItem});
  prep.bootstrap(commands);
  routes.bindResolved(prep.resolved);
  for(const c of commands.filter(c=>Object.hasOwn(routeFields,c.type)))routes.applyStructural(c);
  routes.finishStructural();
  const scheduling=scheduleContext({sources,before,ids:prep.resolved,root,audit,mark,now,actorId,trip:snapshot.trip,createItem,validatePlacement});
  for (const c of commands.filter(c => c.type !== 'create_item'&&!Object.hasOwn(preparationFields,c.type)&&!Object.hasOwn(scheduleFields,c.type)&&!Object.hasOwn(routeFields,c.type)&&!Object.hasOwn(documentFields,c.type))) {
    if (c.type === 'edit_item') {
      const id=reference(c.id,prep.resolved,'item'), item=sources.items.find(i=>i.id===id);
      checkVersion(before.items.find(i=>i.id===id),c); uniqueTarget('items',id);
      Object.assign(item,c.data);validateIdentity(item,sources);mark('items',item);touched.add(id);
    } else if (c.type === 'upsert_placement') {
      const id=reference(c.id,ids,'placement'), p=sources.placements.find(v=>v.id===id), original=before.placements.find(v=>v.id===id);
      if (original) checkVersion(original,c);
      else if (!p || c.expected_version !== 1) invalid('TARGET_UNAVAILABLE','Размещение недоступно.',404);
      uniqueTarget('placements',id);
      const item=sources.items.find(i=>i.id===p.item_id);
      assertEditablePlacement(original,item,before,now);
      Object.assign(p,c.data);
      // Derive dates only when an instant/timezone changes and caller omitted the date.
      for (const [at,date,tz] of [['starts_at','date_start','start_timezone'],['ends_at','date_end','end_timezone']])
        if (p[at] && zoneValid(p[tz]) && !Object.hasOwn(c.data,date) && (Object.hasOwn(c.data,at)||Object.hasOwn(c.data,tz))) p[date]=dayInZone(p[at],p[tz]);
      validatePlacement(p,item);mark('placements',p);touched.add(item.id);
    } else {
      const id = c.type === 'link_place' && c.expected_version === 0 ? ids[c.key]?.link : reference(c.id,ids,'link');
      let link=sources.placement_places.find(l=>l.id===id);
      if (c.type === 'link_place' && c.expected_version===0) {
        if (!validId(id)||link) invalid('ID_CONFLICT','ID связи уже занят.',409);
        const pid=reference(c.placement_id,ids,'placement');
        link={id,trip_id:snapshot.trip.id,placement_id:pid,place_id:null,role:'visit',selection:'chosen',label_snapshot:'',coordinate_snapshot_json:null,sort_order:0,...audit};
        sources.placement_places.push(link);
      } else checkVersion(before.placement_places.find(l=>l.id===id),c);
      uniqueTarget('placement_places',id);
      const p=sources.placements.find(p=>p.id===link.placement_id && p.archived_at==null), item=p&&sources.items.find(i=>i.id===p.item_id);
      if (!p||!item||item.archived_at!=null) invalid('TARGET_UNAVAILABLE','Пункт связи недоступен.',404);
      assertEditablePlacement(before.placements.find(v=>v.id===p.id),item,before,now);
      if (c.type === 'unlink_place') {link.archived_at=now;link.archived_by=actorId;}
      else {
        if (c.expected_version>0 && reference(c.placement_id,ids,'placement')!==link.placement_id) invalid('LINK_OWNER_CHANGED','Нельзя переназначить существующую связь другому пункту.');
        Object.assign(link,c.data);
        const place=link.place_id===null?null:sources.places.find(p=>p.id===link.place_id);
        if (link.place_id!==null&&!place) invalid('PLACE_UNAVAILABLE','Место недоступно.',404);
        if (place&&!Object.hasOwn(c.data,'label_snapshot'))link.label_snapshot=place.name;
        textField(link.label_snapshot,'Место',300,true);
        if (!['visit','lodging','departure','arrival','reference'].includes(link.role)||!['chosen','candidate'].includes(link.selection)||
            !Number.isSafeInteger(link.sort_order)||Math.abs(link.sort_order)>1000000)invalid('INVALID_PLACE_LINK','Проверьте роль, выбор и порядок места.');
        if ((link.role==='lodging'&&item.kind!=='stay')||(['departure','arrival'].includes(link.role)&&item.kind!=='transport')||(link.role==='visit'&&item.kind!=='visit'))
          invalid('INVALID_PLACE_ROLE','Роль места не соответствует пункту.');
      }
      mark('placement_places',link);mark('placements',p);touched.add(item.id);
    }
  }
  for(const c of commands.filter(c=>Object.hasOwn(preparationFields,c.type)))prep.apply(c);
  const documents=documentContext({sources,before,ids:prep.resolved,assets,actorId,trip:snapshot.trip,audit,mark,now});
  for(const c of commands.filter(c=>Object.hasOwn(documentFields,c.type)))documents.apply(c);
  documents.finish(commands);
  for(const c of commands.filter(c=>Object.hasOwn(routeFields,c.type)))routes.apply(c);
  for(const c of commands.filter(c=>Object.hasOwn(routeFields,c.type)))prep.resolved[c.key]={...ids[c.key]};
  validateRouteGraph(sources);
  for(const c of commands.filter(c=>Object.hasOwn(scheduleFields,c.type)))scheduling.apply(c);
  const scheduleState=scheduling.finish(commands);
  const routeState=routes.finish(commands,dirty);
  for(const p of sources.placements.filter(p=>activePlacement(sources,p)))if(!activePlacement(before,before.placements.find(q=>q.id===p.id)))scheduleState.planEdits.add(p.id);
  for(const {collection,row} of dirty.values())if(collection==='placements')touched.add(row.item_id);
  for (const id of touched) {
    const item=sources.items.find(i=>i.id===id);
    for(const p of sources.placements.filter(p=>p.item_id===id&&p.archived_at==null)) {
      const links=sources.placement_places.filter(l=>l.placement_id===p.id&&l.archived_at==null);
      for (const role of ['lodging','departure','arrival'])
        if (links.filter(l=>l.role===role&&l.selection==='chosen').length>1)invalid('DUPLICATE_CHOSEN_ROLE','Для этой роли можно выбрать только одно место.');
      if (dirty.has('placements:'+p.id)) {
        const locations=links.filter(l=>l.role!=='reference');
        p.location_state=locations.some(l=>l.selection==='chosen')?'chosen':locations.length?'candidates':'unspecified';
        validatePlacement(p,item);
        if(item.kind==='stay'&&p.precision!=='unscheduled'&&p.location_state==='chosen'&&!p.start_timezone)
          invalid('STAY_TIMEZONE_REQUIRED','Для выбранного жилья с датами нужен часовой пояс.');
      }
    }
    mark('items',item);
  }
  // Compatibility dates are rebuilt from the working placement; inactive alternatives never leak into old clients.
  for(const item of sources.items.filter(i=>['visit','stay','transport'].includes(i.kind))){
    const p=sources.placements.find(p=>p.item_id===item.id&&activePlacement(sources,p));
    const fields={date_start:p?.date_start??null,date_end:p?.date_end??null,starts_at:p?.starts_at??null,ends_at:p?.ends_at??null,event_timezone:p?.start_timezone||snapshot.trip.timezone,sort_order:p?.order_key??0};
    if(Object.keys(fields).some(k=>item[k]!==fields[k])){Object.assign(item,fields);mark('items',item);}
  }
  const preparation=prep.finish(commands);
  const changes=[];
  for (const {collection,row} of dirty.values()) {
    const old=before[collection].find(v=>v.id===row.id)||null;
    row.version=old?old.version+1:1;row.updated_at=now;row.updated_by=actorId;
    changes.push({collection,id:row.id,before:old,after:row});
  }
  for(const c of commands.filter(c=>c.type==='set_transition_override')){
    const id=c.expected_version===0?prep.resolved[c.key].link:reference(c.id,prep.resolved,'link'),o=sources.transition_overrides.find(o=>o.id===id);
    if(o.archived_at!==null)continue;
    o.context_hash=transitionContext(sources,sources.placements.find(p=>p.id===o.from_placement_id),sources.placements.find(p=>p.id===o.to_placement_id),o.service_id);
    o.source_service_version=o.service_id?sources.services.find(v=>v.id===o.service_id).version:null;
  }
  for(const r of sources.reschedule_requests.filter(r=>r.state==='open'&&scheduleState.requests.has(r.placement_id)))r.sources_json=JSON.stringify(placementConstraints(sources,sources.placements.find(p=>p.id===r.placement_id),now));
  for(const id of scheduling.approved){const p=sources.placements.find(p=>p.id===id);p.approved_context_json=approvalContext(sources,p,now);}
  preparation.derived=derivePlanning(sources,now);
  const outcome=routeOutcome(before,sources,routeState,scheduleOutcome(before,sources,scheduleState,now),now);
  return {sources,changes,...preparation,...outcome,issues:[...preparation.derived.issues.filter(i=>!i.key),...outcome.issues]};
}
