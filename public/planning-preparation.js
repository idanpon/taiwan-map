import { invalid, closed, validId, reference, checkVersion, textField, zoneValid } from './planning-domain-common.js';
import { validDate, dayInZone } from './planning-model.js';
import { live, nights, placeMatchContext, derivePreparation } from './planning-readiness.js';
import { recalculateDeadlines, validateDeadline, validateDeadlineRule } from './planning-targets.js';
import { scopeAncestor } from './planning-scopes.js';

const needFields=['kind','label','required_units','unit_type','criteria'];
const bookingFields=['category','provider_name','reference','note','source_urls'];
const serviceFields=['kind','state','title','validity','starts_at','ends_at','start_timezone','end_timezone','date_start','date_end','capacity_units','unit_type','hold_expires_at','arrival_lead_minutes','exit_allowance_minutes','terms','source_url','replaces_service_id'];
export const preparationFields={
  create_need:['id','scope_id','data'],edit_need:['id','expected_version','data'],set_need_lifecycle:['id','expected_version','lifecycle','reason'],
  ensure_preparation:['need_id','expected_version','task_id','data','as_result'],set_task_state:['id','expected_version','state'],set_route_state:['id','expected_version','state'],
  set_task_activation:['id','expected_version','activation'],
  archive_item:['id','expected_version'],restore_item:['id','expected_version'],
  record_booking:['id','data'],edit_booking:['id','expected_version','data'],
  add_service:['id','booking_id','data'],correct_service:['id','expected_version','data','reason'],
  set_service_state:['id','expected_version','state','reason'],replace_service:['id','expected_version','replacement_id','reason'],
  split_service:['id','expected_version','mode','parts','reason'],
};
const linkDefinitions={
  need_target:{collection:'need_targets',refs:{need_id:'need',placement_id:'placement'},fields:[]},
  need_task:{collection:'need_tasks',refs:{need_id:'need',task_id:'item'},fields:['relation']},
  task_result:{collection:'need_task_results',refs:{need_id:'need',task_id:'item'},fields:[]},
  service_task:{collection:'service_tasks',refs:{service_id:'service',task_id:'item'},fields:['action']},
  prerequisite:{collection:'task_prerequisites',refs:{task_id:'item',required_task_id:'item'},fields:[]},
  need_service:{collection:'need_services',refs:{need_id:'need',service_id:'service'},fields:['allocated_units','use_mode','context_note','verify_place']},
  service_place:{collection:'service_places',refs:{service_id:'service'},fields:['place_id','role','label_snapshot']},
  need_exemption:{collection:'need_exemptions',refs:{need_id:'need',placement_id:'placement'},fields:['date_start','date_end','reason']},
  deadline:{collection:'deadlines',refs:{},fields:['task_id','service_id','kind','at','local_date','timezone','origin','source_url','note','mode']},
  deadline_rule:{collection:'deadline_rules',refs:{task_id:'item',anchor_placement_id:'placement'},fields:['anchor','offset_minutes','offset_days','rule_timezone','enabled']},
};
for(const [name,def] of Object.entries(linkDefinitions)){
  preparationFields['set_'+name]=['id','expected_version',...Object.keys(def.refs),'data'];
  preparationFields['remove_'+name]=['id','expected_version'];
}
const creations=new Set(['create_need','record_booking','add_service']);
export function validatePreparationCommand(c){
  if(creations.has(c.type)){
    if(c.id!==undefined&&!validId(c.id))invalid('INVALID_ID','Некорректный ID.');
  }else if(!Number.isSafeInteger(c.expected_version)||c.expected_version<(c.type.startsWith('set_')&&Object.hasOwn(linkDefinitions,c.type.slice(4))?0:1))invalid('EXPECTED_VERSION_REQUIRED','Укажите ожидаемую версию.',400);
  const fields=c.type.endsWith('_need')?needFields:c.type.endsWith('_booking')?bookingFields:['add_service','correct_service'].includes(c.type)?serviceFields:null;
  if(fields)closed(c.data,fields);
  if(c.type==='edit_need'&&Object.hasOwn(c.data,'kind'))invalid('IMMUTABLE_NEED_KIND','Для другого типа создайте отдельную потребность.');
  if(c.type==='ensure_preparation'){closed(c.data||{},['title','assignee_id']);if(c.as_result!==undefined&&typeof c.as_result!=='boolean')invalid('INVALID_RESULT_FLAG','Некорректный признак результата.');}
  if(c.type.startsWith('set_')&&linkDefinitions[c.type.slice(4)])closed(c.data,linkDefinitions[c.type.slice(4)].fields);
}
export function preparationAllocations(c){
  if(c.type==='create_need')return ['need'];
  if(c.type==='record_booking')return ['booking'];
  if(c.type==='add_service')return ['service'];
  if(c.type==='ensure_preparation')return ['item','link','result'];
  if(c.type.startsWith('set_')&&linkDefinitions[c.type.slice(4)]&&c.expected_version===0)return ['link'];
  if(c.type==='split_service'){
    if(!Array.isArray(c.parts)||c.parts.length<2||c.parts.length>50)invalid('INVALID_SPLIT','Нужны от 2 до 50 частей.');
    return c.parts.flatMap((_,i)=>['service_'+i]);
  }
  return [];
}
const oneOf=(value,values)=>{if(!values.includes(value))invalid('INVALID_VALUE','Недопустимое значение: '+String(value));};
export function instant(value){return typeof value==='string'&&/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/.test(value)&&validDate(value.slice(0,10))&&Number.isFinite(Date.parse(value));}
const positive=(value,zero=false)=>value===null||Number.isSafeInteger(value)&&value>=(zero?0:1)&&value<=1000000;
export function url(value){if(value===null)return;try{if(!['https:','http:'].includes(new URL(value).protocol))throw Error();}catch{invalid('INVALID_URL','Нужна ссылка HTTP или HTTPS.');}if(value.length>4000)invalid('INVALID_URL','Ссылка слишком длинная.');}
function jsonFields(data,row){
  for(const [key,value] of Object.entries(data)){
    if(['criteria','terms'].includes(key))row[key+'_json']=JSON.stringify(value);
    else if(key==='source_urls')row[key]=JSON.stringify(value);
    else row[key]=value;
  }
}
function validateNeed(n){
  oneOf(n.kind,['admission','accommodation','transport','task_result','decision_result']);textField(n.label,'Потребность',300,true);
  oneOf(n.unit_type,['person','room','group','unspecified']);if(!positive(n.required_units))invalid('INVALID_QUANTITY','Количество должно быть положительным.');
  const c=JSON.parse(n.criteria_json);closed(c,['schema_version','allowed_service_kinds','require_confirmed','require_selected_location']);
  if(c.schema_version!==1)invalid('INVALID_CRITERIA','Неизвестная версия условий.');
  for(const k of ['require_confirmed','require_selected_location'])if(c[k]!==undefined&&c[k]!==true)invalid('UNSUPPORTED_CRITERIA','В этом этапе готовность требует подтверждённой услуги и проверки места.');
  if(c.allowed_service_kinds!==undefined&&(!Array.isArray(c.allowed_service_kinds)||!c.allowed_service_kinds.length||c.allowed_service_kinds.some(v=>!['admission','stay','transport'].includes(v))))invalid('INVALID_CRITERIA','Неизвестный тип услуги.');
}
function validateBooking(b){
  oneOf(b.category,['activity','lodging','air','rail','other']);textField(b.provider_name,'Поставщик',300);textField(b.note,'Заметка',5000);
  if(b.reference!==null)textField(b.reference,'Номер брони',300);
  const urls=JSON.parse(b.source_urls);if(!Array.isArray(urls)||urls.length>30)invalid('INVALID_URLS','Не более 30 ссылок.');for(const u of urls){if(typeof u!=='string')invalid('INVALID_URL','Некорректная ссылка.');url(u);}
}
export function validateService(s){
  oneOf(s.kind,['admission','stay','transport']);oneOf(s.state,['pending','held','confirmed','cancelled','used','expired','superseded']);
  oneOf(s.validity,['exact_start','exact_interval','date_range','open_window','unknown']);textField(s.title,'Услуга',300,true);
  oneOf(s.unit_type,['person','room','group','unspecified']);
  for(const k of ['capacity_units','arrival_lead_minutes','exit_allowance_minutes'])if(!positive(s[k],k!=='capacity_units'))invalid('INVALID_QUANTITY','Некорректное количество или запас времени.');
  for(const k of ['starts_at','ends_at'])if(s[k]!==null&&!instant(s[k]))invalid('INVALID_INSTANT','Нужен корректный момент UTC.');
  for(const k of ['date_start','date_end'])if(s[k]!==null&&!validDate(s[k]))invalid('INVALID_DATE','Некорректная дата услуги.');
  for(const k of ['start_timezone','end_timezone'])if(s[k]!==null&&!zoneValid(s[k]))invalid('INVALID_TIMEZONE','Некорректный часовой пояс.');
  for(const [at,date,zone] of [['starts_at','date_start','start_timezone'],['ends_at','date_end','end_timezone']])if(s[at]&&(!s[zone]||s[date]!==dayInZone(s[at],s[zone])))invalid('SERVICE_DATE_MISMATCH','Дата услуги не соответствует моменту и часовому поясу.');
  if(s.starts_at&&s.ends_at&&Date.parse(s.starts_at)>=Date.parse(s.ends_at))invalid('INVALID_INTERVAL','Некорректный интервал услуги.');
  if(['exact_start','exact_interval','open_window'].includes(s.validity)&&!s.starts_at)invalid('SERVICE_TIME_REQUIRED','Не указано время услуги.');
  if(['exact_interval','open_window'].includes(s.validity)&&!s.ends_at)invalid('SERVICE_TIME_REQUIRED','Нужны обе границы услуги.');
  if(s.validity==='date_range'&&(!s.date_start||!s.date_end||s.date_start>s.date_end||!s.start_timezone))invalid('SERVICE_DATES_REQUIRED','Нужны даты и часовой пояс услуги.');
  if(s.kind==='stay'&&s.validity!=='unknown'&&(s.validity!=='date_range'||!nights(s.date_start,s.date_end).length))invalid('INVALID_STAY_SERVICE','Проживание задаётся ночами между заселением и выездом.');
  if(s.kind==='transport'&&!['exact_interval','unknown'].includes(s.validity))invalid('INVALID_TRANSPORT_SERVICE','У сегмента транспорта нужны оба момента либо неизвестное время.');
  if(s.hold_expires_at!==null&&(!Number.isSafeInteger(s.hold_expires_at)||s.hold_expires_at<0))invalid('INVALID_HOLD_EXPIRY','Некорректный срок удержания.');
  url(s.source_url);
  const t=JSON.parse(s.terms_json);closed(t,['schema_version','usage','allowed_uses','change_policy','cancellation_policy','notes','amount_minor','currency','min_duration_minutes','max_duration_minutes','check_in_earliest','check_in_latest','check_out_latest']);
  if(t.schema_version!==1)invalid('INVALID_TERMS','Неизвестная версия условий.');
  if(t.usage!==undefined)oneOf(t.usage,['single','group','reusable']);
  for(const k of ['change_policy','cancellation_policy'])if(t[k]!==undefined)oneOf(t[k],['allowed','forbidden','unknown']);
  for(const k of ['allowed_uses','min_duration_minutes','max_duration_minutes'])if(t[k]!==undefined&&!positive(t[k]))invalid('INVALID_TERMS','Некорректный предел использования.');
  if(t.min_duration_minutes!=null&&t.max_duration_minutes!=null&&t.min_duration_minutes>t.max_duration_minutes)invalid('INVALID_TERMS','Минимум больше максимума.');
  if(t.notes!==undefined)textField(t.notes,'Условия',5000);
  if(t.amount_minor!==undefined&&t.amount_minor!==null&&(!Number.isSafeInteger(t.amount_minor)||t.amount_minor<0))invalid('INVALID_AMOUNT','Некорректная сумма.');
  if(t.currency!==undefined&&t.currency!==null&&(typeof t.currency!=='string'||!/^[A-Z]{3}$/.test(t.currency)))invalid('INVALID_CURRENCY','Нужен код валюты.');
  if(t.amount_minor!=null&&!t.currency)invalid('CURRENCY_REQUIRED','Для суммы нужна валюта.');
  for(const k of ['check_in_earliest','check_in_latest','check_out_latest'])if(t[k]!=null){closed(t[k],['local_time','day_offset','timezone']);if(s.kind!=='stay'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t[k].local_time)||!Number.isSafeInteger(t[k].day_offset)||Math.abs(t[k].day_offset)>7||!zoneValid(t[k].timezone))invalid('INVALID_STAY_TERMS','Некорректные условия заселения/выезда.');}
}

export function preparationContext(ctx){
  const {sources:s,before,ids,root,audit,mark,now,actorId,trip,createItem}=ctx;
  const resolved=structuredClone(ids),verified=[];
  const collections={need:'needs',booking:'bookings',service:'services',placement:'placements',item:'items'};
  function ref(value,entity){const id=reference(value,resolved,entity),row=s[collections[entity]].find(x=>x.id===id);if(!live(row))invalid('TARGET_UNAVAILABLE','Связанная запись недоступна.',404);return row;}
  function version(row,c,collection,restore=false){const old=before[collection].find(x=>x.id===row.id)||row;if(restore){if(old.version!==c.expected_version)invalid('VERSION_CONFLICT','Запись изменилась.',409);}else checkVersion(old,c);}
  function add(collection,id,data){if(!validId(id)||s[collection].some(x=>x.id===id))invalid('ID_CONFLICT','ID записи уже занят.',409);const row={id,trip_id:trip.id,...data,...audit};s[collection].push(row);mark(collection,row);return row;}
  function touch(collection,id){const r=s[collection].find(x=>x.id===id);if(r)mark(collection,r);}
  function parents(row){if(row.need_id)touch('needs',row.need_id);if(row.service_id){touch('services',row.service_id);const service=s.services.find(x=>x.id===row.service_id);if(service)touch('bookings',service.booking_id);}if(row.task_id)touch('items',row.task_id);if(row.placement_id){touch('placements',row.placement_id);const p=s.placements.find(x=>x.id===row.placement_id);if(p)touch('items',p.item_id);}}
  function archive(collection,row){row.archived_at=now;row.archived_by=actorId;mark(collection,row);parents(row);}
  function bootstrap(commands){
    for(const c of commands.filter(c=>c.type==='create_need'||c.type==='record_booking')){
      if(c.type==='create_need'){
        const n=add('needs',resolved[c.key].need,{scope_id:c.scope_id?reference(c.scope_id,resolved,'scope'):root.id,kind:'admission',label:'',lifecycle:'active',waived_reason:null,required_units:null,unit_type:'unspecified',criteria_json:'{"schema_version":1}'});jsonFields(c.data,n);validateNeed(n);
      }else{const b=add('bookings',resolved[c.key].booking,{category:'other',provider_name:'',reference:null,note:'',source_urls:'[]'});jsonFields(c.data,b);validateBooking(b);}
    }
    for(const c of commands.filter(c=>c.type==='add_service')){
      const b=ref(c.booking_id,'booking');const service=add('services',resolved[c.key].service,{booking_id:b.id,kind:'admission',state:'pending',title:'',validity:'unknown',starts_at:null,ends_at:null,start_timezone:null,end_timezone:null,date_start:null,date_end:null,capacity_units:null,unit_type:'unspecified',hold_expires_at:null,arrival_lead_minutes:null,exit_allowance_minutes:null,terms_json:'{"schema_version":1}',source_url:null,replaces_service_id:null,origin:'manual'});
      jsonFields(c.data,service);touch('bookings',b.id);
    }
    for(const c of commands.filter(c=>c.type==='add_service')){const service=s.services.find(x=>x.id===resolved[c.key].service);normalizeService(service,c.data);validateService(service);}
    for(const c of commands.filter(c=>c.type==='ensure_preparation')){
      const need=ref(c.need_id,'need');version(need,c,'needs');
      if(need.lifecycle!=='active')invalid('NEED_NOT_ACTIVE','Сначала восстановите потребность.');
      const available=s.need_tasks.filter(l=>live(l)&&l.need_id===need.id&&l.relation==='produce').map(l=>s.items.find(i=>i.id===l.task_id)).filter(t=>live(t)&&['open','in_progress'].includes(t.state));
      if(!c.task_id&&available.length>1)invalid('AMBIGUOUS_PREPARATION','Для потребности уже есть несколько задач. Укажите нужную.');
      let task=c.task_id?ref(c.task_id,'item'):available[0];
      if(task&&(task.kind!=='task'||!['open','in_progress'].includes(task.state)))invalid('TASK_NOT_OPEN','Нужна незавершённая задача подготовки.');
      if(!task){task=createItem(resolved[c.key].item,null,{kind:'task',title:c.data?.title||need.label,...c.data});task.task_activation='linked_needs';}
      resolved[c.key].item=task.id;
      let link=s.need_tasks.find(l=>live(l)&&l.need_id===need.id&&l.task_id===task.id);
      if(!link)link=add('need_tasks',resolved[c.key].link,{need_id:need.id,task_id:task.id,relation:'produce'});
      else if(link.relation!=='produce'){link.relation='produce';mark('need_tasks',link);}
      resolved[c.key].link=link.id;parents(link);
      if(c.as_result){if(need.kind!=='task_result')invalid('INVALID_TASK_RESULT','Выполнение задачи не заменяет билет или бронь.');let result=s.need_task_results.find(l=>live(l)&&l.need_id===need.id&&l.task_id===task.id);if(!result)result=add('need_task_results',resolved[c.key].result,{need_id:need.id,task_id:task.id});resolved[c.key].result=result.id;}
    }
  }
  function normalizeService(service,data){
    if(data.replaces_service_id!=null)service.replaces_service_id=ref(data.replaces_service_id,'service').id;
    for(const [at,date,tz] of [['starts_at','date_start','start_timezone'],['ends_at','date_end','end_timezone']])if(service[at]&&zoneValid(service[tz])&&!Object.hasOwn(data,date))service[date]=dayInZone(service[at],service[tz]);
  }
  function apply(c){
    if(creations.has(c.type)||c.type==='ensure_preparation')return;
    if(['edit_need','set_need_lifecycle'].includes(c.type)){
      const n=ref(c.id,'need');version(n,c,'needs');
      if(c.type==='edit_need'){jsonFields(c.data,n);validateNeed(n);}else{oneOf(c.lifecycle,['active','waived','retired']);textField(c.reason,'Причина',2000,true);n.lifecycle=c.lifecycle;n.waived_reason=c.lifecycle==='active'?null:c.reason;}
      mark('needs',n);return;
    }
    if(['set_task_state','set_route_state','set_task_activation','archive_item','restore_item'].includes(c.type)){
      const id=reference(c.id,resolved,'item'),item=s.items.find(x=>x.id===id);if(!item)invalid('TARGET_UNAVAILABLE','Запись недоступна.',404);version(item,c,'items',c.type==='restore_item');
      if(c.type==='set_task_state'){if(item.kind!=='task')invalid('TASK_REQUIRED','Эта команда изменяет только задачу.');oneOf(c.state,['open','in_progress','done','cancelled']);item.state=c.state;item.completed_at=c.state==='done'?(item.completed_at??now):null;}
      else if(c.type==='set_route_state'){if(!['visit','stay','transport'].includes(item.kind))invalid('ROUTE_ITEM_REQUIRED','Нужен пункт маршрута.');oneOf(c.state,['open','in_progress','done','cancelled']);item.state=c.state;item.completed_at=c.state==='done'?(item.completed_at??now):null;}
      else if(c.type==='set_task_activation'){if(item.kind!=='task')invalid('TASK_REQUIRED','Нужна задача подготовки.');oneOf(c.activation,['independent','linked_needs','scope']);item.task_activation=c.activation;}
      else {item.archived_at=c.type==='archive_item'?now:null;item.archived_by=c.type==='archive_item'?actorId:null;}
      mark('items',item);return;
    }
    if(c.type==='edit_booking'){const b=ref(c.id,'booking');version(b,c,'bookings');jsonFields(c.data,b);validateBooking(b);mark('bookings',b);return;}
    if(['correct_service','set_service_state','replace_service','split_service'].includes(c.type)){
      const service=ref(c.id,'service');version(service,c,'services');textField(c.reason,'Причина',2000,true);
      if(c.type==='correct_service'){if(c.data.kind&&c.data.kind!==service.kind)invalid('IMMUTABLE_SERVICE_KIND','Для другого типа услуги нужна новая запись.');jsonFields(c.data,service);normalizeService(service,c.data);}
      else if(c.type==='set_service_state'){
        const allowed={pending:['held','confirmed','cancelled','expired'],held:['confirmed','cancelled','expired'],confirmed:['cancelled','used'],cancelled:[],used:[],expired:[],superseded:[]};
        if(!allowed[service.state].includes(c.state))invalid('INVALID_SERVICE_TRANSITION','Для исправления факта используйте correct_service с причиной.');service.state=c.state;
      }else if(c.type==='replace_service'){
        const replacement=ref(c.replacement_id,'service');if(service.id===replacement.id||replacement.kind!==service.kind||!['confirmed','used'].includes(replacement.state)||['cancelled','superseded'].includes(service.state))invalid('INVALID_REPLACEMENT','Нужна другая подтверждённая услуга того же типа.');
        if(replacement.replaces_service_id&&replacement.replaces_service_id!==service.id)invalid('INVALID_REPLACEMENT','У замены уже указан другой исходный результат.');
        replacement.replaces_service_id=service.id;service.state='superseded';mark('services',replacement);touch('bookings',replacement.booking_id);
      }else split(service,c);
      validateService(service);mark('services',service);touch('bookings',service.booking_id);return;
    }
    const removing=c.type.startsWith('remove_'),name=c.type.slice(removing?7:4),def=linkDefinitions[name];
    if(!def)invalid('UNSUPPORTED_COMMAND','Неизвестная операция подготовки.');
    let link;
    if(!removing&&c.expected_version===0){link=add(def.collection,resolved[c.key].link,defaults(name,trip.timezone));for(const [key,entity] of Object.entries(def.refs))link[key]=ref(c[key],entity).id;}
    else{const id=reference(c.id,resolved,'link');link=s[def.collection].find(x=>x.id===id);if(!link)invalid('TARGET_UNAVAILABLE','Связь недоступна.',404);version(link,c,def.collection);}
    if(removing){archive(def.collection,link);return;}
    for(const [key,entity] of Object.entries(def.refs))if(ref(c[key],entity).id!==link[key])invalid('LINK_OWNER_CHANGED','Переназначение связи требует новой записи.');
    Object.assign(link,c.data);
    if(name==='need_service'){
      delete link.verify_place;const verify=c.data.verify_place;
      if(verify!==undefined&&typeof verify!=='boolean')invalid('INVALID_VERIFICATION','Подтверждение должно быть явным.');
      if(verify===true){textField(link.context_note,'Причина проверки места',2000,true);verified.push(link);}if(verify===false){link.place_match_override='none';link.place_match_context_hash=null;}
    }
    if(name==='service_place'){
      if(link.place_id!==null){const place=s.places.find(p=>p.id===link.place_id);if(!place)invalid('PLACE_UNAVAILABLE','Место недоступно.',404);if(!Object.hasOwn(c.data,'label_snapshot'))link.label_snapshot=place.name;}
    }
    if(name==='deadline'){
      if(link.task_id!==null)link.task_id=ref(link.task_id,'item').id;
      if(link.service_id!==null)link.service_id=ref(link.service_id,'service').id;
      if(link.service_id&&!Object.hasOwn(c.data,'mode'))link.mode=null;
      const old=before.deadlines.find(d=>d.id===link.id);
      if(old&&(old.task_id!==link.task_id||old.service_id!==link.service_id||old.kind!==link.kind))invalid('LINK_OWNER_CHANGED','Владелец и тип существующего срока не меняются.');
      link.aggregate=link.mode==='relative'?'min':null;
    }
    mark(def.collection,link);parents(link);
  }
  function split(service,c){
    oneOf(c.mode,['nights','capacity','segments']);
    if(!['held','confirmed','pending'].includes(service.state))invalid('INVALID_SPLIT_STATE','Разделять можно действующую услугу.');
    preparationAllocations(c);
    if(c.mode==='nights'&&(service.kind!=='stay'||!nights(service.date_start,service.date_end).length))invalid('INVALID_SPLIT','Для разделения ночей нужен известный период жилья.');
    if(c.mode==='capacity'&&service.capacity_units==null)invalid('INVALID_SPLIT','Для разделения билетов нужно известное количество.');
    if(c.mode==='segments'&&(service.kind!=='transport'||service.validity!=='exact_interval'))invalid('INVALID_SPLIT','Для разделения сегментов нужен известный интервал транспорта.');
    const parts=c.parts.map((data,i)=>{
      closed(data,[...(c.mode==='nights'?['date_start','date_end']:c.mode==='capacity'?['capacity_units']:['starts_at','ends_at','start_timezone','end_timezone','places']),'allocations','document_ids']);
      const {allocations,places,document_ids,...fields}=data;
      if(allocations!==undefined&&(!Array.isArray(allocations)||allocations.length>100))invalid('INVALID_SPLIT_MAPPING','Нужен список распределений для каждой части.');
      if(c.mode==='segments'&&(!Array.isArray(places)||places.length!==2))invalid('INVALID_SPLIT_PLACES','Укажите два конца каждого сегмента.');
      const child={...service,...fields,id:resolved[c.key]['service_'+i],replaces_service_id:service.id,...audit};
      normalizeService(child,fields);validateService(child);return {child,allocations,places};
    });
    if(c.mode==='nights'){
      parts.sort((a,b)=>a.child.date_start.localeCompare(b.child.date_start));
      if(parts[0].child.date_start!==service.date_start||parts.at(-1).child.date_end!==service.date_end||parts.some((p,i)=>i>0&&parts[i-1].child.date_end!==p.child.date_start))invalid('SPLIT_COVERAGE_CHANGED','Части должны точно покрывать исходные ночи без пропусков и пересечений.');
    }else if(c.mode==='capacity'){
      if(parts.some(p=>p.child.capacity_units===null)||parts.reduce((n,p)=>n+p.child.capacity_units,0)!==service.capacity_units)invalid('SPLIT_CAPACITY_CHANGED','Сумма частей должна равняться исходному количеству.');
    }else{
      parts.sort((a,b)=>Date.parse(a.child.starts_at)-Date.parse(b.child.starts_at));
      if(Date.parse(parts[0].child.starts_at)!==Date.parse(service.starts_at)||Date.parse(parts.at(-1).child.ends_at)!==Date.parse(service.ends_at)||parts.some((p,i)=>i>0&&Date.parse(parts[i-1].child.ends_at)>Date.parse(p.child.starts_at)))invalid('SPLIT_COVERAGE_CHANGED','Сегменты должны сохранять начало и конец поездки без пересечений.');
      const endpoint=(list,role)=>list.find(l=>l.role===role)?.place_id;
      const original=s.service_places.filter(l=>live(l)&&l.service_id===service.id);
      const boundaries=[[endpoint(original,'departure'),endpoint(parts[0].places,'departure')],[endpoint(original,'arrival'),endpoint(parts.at(-1).places,'arrival')],...parts.slice(1).map((p,i)=>[endpoint(parts[i].places,'arrival'),endpoint(p.places,'departure')])];
      if(boundaries.some(([a,b])=>!a||!b||a!==b))invalid('SPLIT_ENDPOINTS_UNVERIFIED','Для разделения сегментов нужны одинаковые ID стыкующихся мест и сохранённые исходные концы.');
    }
    const allocations=s.need_services.filter(l=>live(l)&&l.service_id===service.id);
    if(c.mode!=='nights'&&allocations.length&&parts.some(p=>p.allocations===undefined))invalid('SPLIT_ALLOCATIONS_REQUIRED','Явно распределите потребности по частям; пустой список оставляет часть без назначения.');
    for(const {child,allocations:mapping,places:partPlaces} of parts){
      add('services',child.id,child);
      const locations=partPlaces||s.service_places.filter(l=>live(l)&&l.service_id===service.id);
      for(const [i,place] of locations.entries()){
        if(partPlaces)closed(place,['place_id','role','label_snapshot']);
        const known=place.place_id?s.places.find(p=>p.id===place.place_id):null;
        if(partPlaces&&!known)invalid('PLACE_UNAVAILABLE','Для сегмента нужно место из реестра.',404);
        add('service_places',child.id+'_place_'+i,{service_id:child.id,place_id:place.place_id,role:place.role,label_snapshot:place.label_snapshot||known?.name||''});
      }
      const targets=mapping===undefined?allocations:mapping;
      for(const [i,link] of targets.entries()){
        if(mapping!==undefined)closed(link,['need_id','allocated_units','use_mode','context_note']);
        const need=ref(link.need_id,'need');
        const copy=add('need_services',child.id+'_need_'+i,{...defaults('need_service'),need_id:need.id,service_id:child.id,allocated_units:link.allocated_units??null,use_mode:link.use_mode||'exclusive',context_note:link.context_note||''});parents(copy);
      }
      // A split preserves supplier deadlines on each surviving part; no time is recalculated.
      for(const [i,d] of s.deadlines.filter(d=>live(d)&&d.service_id===service.id).entries())add('deadlines',child.id+'_deadline_'+i,{...d,id:child.id+'_deadline_'+i,service_id:child.id});
    }
    for(const link of allocations)archive('need_services',link);
    service.state='superseded';
    // Open reconciliation work remains attached to the historical source, never auto-completed.
  }
  function finish(commands){
    for(const link of verified){link.place_match_override='verified';link.place_match_context_hash=placeMatchContext(s,link.need_id,link.service_id);}
    validateGraph(s);
    const derived=derivePreparation(s,now);
    for(const c of commands.filter(c=>c.type==='set_task_state'&&c.state==='done')){
      const task=ref(c.id,'item'),d=derived.tasks.find(t=>t.id===task.id);if(d.blocked_by.length)invalid('TASK_PREREQUISITE_BLOCKED','Сначала завершите обязательные задачи.');
    }
    recalculateDeadlines({...ctx,sources:s});
    return {resolved_ids:resolved,derived:derivePreparation(s,now)};
  }
  return {bootstrap,apply,finish,resolved};
}
function defaults(name,timezone='UTC'){
  return {need_task:{relation:'produce'},service_task:{action:'review'},need_service:{allocated_units:null,use_mode:'exclusive',context_note:'',place_match_override:'none',place_match_context_hash:null},service_place:{place_id:null,role:'visit',label_snapshot:''},
    deadline:{task_id:null,service_id:null,kind:'target',at:null,local_date:null,timezone,origin:'manual',source_url:null,note:'',mode:'manual',aggregate:null},
    deadline_rule:{anchor:'start',offset_minutes:null,offset_days:null,rule_timezone:timezone,enabled:1}}[name]||{};
}
function validateGraph(s){
  const get=(collection,id)=>{const row=s[collection].find(x=>x.id===id);if(!row)invalid('TARGET_UNAVAILABLE','Связанный объект недоступен.',404);return row;};
  const task=id=>{const t=get('items',id);if(t.kind!=='task')invalid('TASK_REQUIRED','Связь требует задачу подготовки.');return t;};
  for(const [name,def] of Object.entries(linkDefinitions)){
    const keys=new Set();
    for(const l of s[def.collection].filter(live)){
      const unique=JSON.stringify(Object.keys(def.refs).map(k=>l[k]).concat(name==='service_task'?[l.action]:name==='service_place'?[l.role,l.place_id,l.label_snapshot]:name==='deadline_rule'?[l.anchor]:name==='need_exemption'?[l.id]:name==='deadline'?[l.kind==='target'?l.task_id:l.id]:[]));
      if(keys.has(unique))invalid('DUPLICATE_LINK','Такая связь уже существует.');keys.add(unique);
      if(l.task_id)task(l.task_id);
      if(name==='need_target'){
        const need=get('needs',l.need_id),p=get('placements',l.placement_id),item=get('items',p.item_id),expected={admission:'visit',accommodation:'stay',transport:'transport'}[need.kind];
        if(!scopeAncestor(s,need.scope_id,p.scope_id)||(expected&&expected!==item.kind))invalid('INVALID_NEED_TARGET','Тип или область потребности не соответствует пункту.');
      }
      if(name==='need_task')oneOf(l.relation,['produce','review']);
      if(name==='task_result'&&get('needs',l.need_id).kind!=='task_result')invalid('INVALID_TASK_RESULT','Выполнение задачи не заменяет билет или бронь.');
      if(name==='service_task')oneOf(l.action,['exchange','cancel','review']);
      if(name==='prerequisite'){task(l.required_task_id);if(l.task_id===l.required_task_id)invalid('TASK_DEPENDENCY_CYCLE','Задача не может зависеть от себя.');}
      if(name==='need_service'){
        const n=get('needs',l.need_id),service=get('services',l.service_id);if(['task_result','decision_result'].includes(n.kind))invalid('INVALID_SERVICE_RESULT','Для этой потребности нужен другой тип результата.');
        if(!positive(l.allocated_units))invalid('INVALID_QUANTITY','Некорректное распределение.');oneOf(l.use_mode,['exclusive','shared']);textField(l.context_note,'Пояснение',2000);
        if(l.use_mode==='shared'&&JSON.parse(service.terms_json).usage!=='reusable')invalid('SERVICE_NOT_REUSABLE','Совместное использование требует многоразового билета.');
      }
      if(name==='service_place'){
        const service=get('services',l.service_id);oneOf(l.role,['visit','lodging','departure','arrival','reference']);textField(l.label_snapshot,'Место услуги',300,true);
        if(l.role!=='reference'&&!(service.kind==='admission'?['visit']:service.kind==='stay'?['lodging']:['departure','arrival']).includes(l.role))invalid('INVALID_PLACE_ROLE','Роль места не соответствует услуге.');
        if(l.place_id!==null&&!s.places.some(p=>p.id===l.place_id))invalid('PLACE_UNAVAILABLE','Место недоступно.',404);
      }
      if(name==='need_exemption'){
        textField(l.reason,'Причина исключения',2000,true);if(get('needs',l.need_id).kind!=='accommodation'||!nights(l.date_start,l.date_end).length||!validDate(l.date_start)||!validDate(l.date_end)||!s.need_targets.some(t=>live(t)&&t.need_id===l.need_id&&t.placement_id===l.placement_id))invalid('INVALID_NIGHT_EXEMPTION','Исключение задаётся для ночей связанного жилья.');
        const p=get('placements',l.placement_id);if(!p.date_start||!p.date_end||l.date_start<p.date_start||l.date_end>p.date_end)invalid('EXEMPTION_OUTSIDE_STAY','Ночи исключения выходят за период жилья.');
      }
      if(name==='deadline')validateDeadline(l);
      if(name==='deadline_rule')validateDeadlineRule(l,s);
    }
  }
  for(const service of s.services.filter(live)){
    if(service.replaces_service_id){const seen=new Set([service.id]);let next=service;while(next.replaces_service_id){if(seen.has(next.replaces_service_id))invalid('REPLACEMENT_CYCLE','Замены образуют цикл.');seen.add(next.replaces_service_id);next=get('services',next.replaces_service_id);if(next.kind!==service.kind)invalid('INVALID_REPLACEMENT','Замена должна быть того же типа.');}}
    for(const role of ['lodging','departure','arrival'])if(s.service_places.filter(l=>live(l)&&l.service_id===service.id&&l.role===role).length>1)invalid('DUPLICATE_SERVICE_ROLE','Для этой роли можно указать только одно место.');
  }
  const visited=new Set(),visiting=new Set();
  const visit=id=>{if(visiting.has(id))invalid('TASK_DEPENDENCY_CYCLE','Обязательные задачи образуют цикл.');if(visited.has(id))return;visiting.add(id);for(const l of s.task_prerequisites.filter(l=>live(l)&&l.task_id===id))visit(l.required_task_id);visiting.delete(id);visited.add(id);};
  for(const t of s.items.filter(i=>i.kind==='task'))visit(t.id);
}
