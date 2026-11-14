import {ref} from './route-ui-fixture.mjs';
export function routeUIScenario(f){
 const tz='Asia/Taipei',slot=(day,hour,end)=>({precision:'exact',starts_at:`2035-01-${day}T${hour}:00:00.000Z`,ends_at:`2035-01-${day}T${end}:00:00.000Z`,start_timezone:tz,end_timezone:tz});
 const route=(key,title,time)=>[{key,type:'create_item',data:{kind:'visit',title}},{key:key+'slot',type:'upsert_placement',id:ref(key,'placement'),expected_version:1,data:time},{key:key+'place',type:'link_place',placement_id:ref(key,'placement'),expected_version:0,data:{role:'visit',place_id:'taipei-101',selection:'chosen'}}];
 const ids=f.write([...route('lunch','Обед перед прогулкой',slot('04','05','06')),...route('walk','Прогулка по Синьи',slot('04','07','08')),...route('tower','Taipei 101',slot('04','09','10')),
  {key:'ticketNeed',type:'create_need',data:{kind:'admission',label:'Билеты на смотровую',required_units:2,unit_type:'person'}},
  {key:'ticketTarget',type:'set_need_target',expected_version:0,need_id:ref('ticketNeed','need'),placement_id:ref('tower','placement'),data:{}},
  {key:'ticketTask',type:'ensure_preparation',expected_version:1,need_id:ref('ticketNeed','need'),data:{title:'Купить билеты на Taipei 101'}},
  {key:'booking',type:'record_booking',data:{category:'activity',provider_name:'Taipei 101 · демонстрация',reference:'DEMO-101'}},
  {key:'ticket',type:'add_service',booking_id:ref('booking','booking'),data:{kind:'admission',title:'Смотровая Taipei 101',state:'confirmed',validity:'exact_start',starts_at:'2035-01-04T09:00:00.000Z',start_timezone:tz,capacity_units:2,unit_type:'person'}},
  {key:'ticketPlace',type:'set_service_place',expected_version:0,service_id:ref('ticket','service'),data:{role:'visit',place_id:'taipei-101'}},
  {key:'ticketBind',type:'set_need_service',expected_version:0,need_id:ref('ticketNeed','need'),service_id:ref('ticket','service'),data:{allocated_units:2}},
  {key:'hotel',type:'create_item',data:{kind:'stay',title:'Жильё в Тайбэе — уточнить отель',note:'Демонстрационная заметка. Сохранить при пересмотре маршрута.'}},
  {key:'hotelSlot',type:'upsert_placement',id:ref('hotel','placement'),expected_version:1,data:{precision:'day',date_start:'2035-01-04',date_end:'2035-01-07',start_timezone:tz,end_timezone:tz}},
  {key:'hotelPlace',type:'link_place',placement_id:ref('hotel','placement'),expected_version:0,data:{role:'lodging',place_id:'taipei-101',selection:'chosen'}},
  {key:'hotelNeed',type:'create_need',data:{kind:'accommodation',label:'Жильё на три ночи',required_units:1,unit_type:'room'}},
  {key:'hotelTarget',type:'set_need_target',expected_version:0,need_id:ref('hotelNeed','need'),placement_id:ref('hotel','placement'),data:{}},
  {key:'hotelTask',type:'ensure_preparation',need_id:ref('hotelNeed','need'),expected_version:1,data:{title:'Выбрать и забронировать жильё'}},
  {key:'hotelBooking',type:'record_booking',data:{category:'lodging',provider_name:'Демонстрационный отель',reference:'DEMO-HOTEL'}},
  {key:'hotelService',type:'add_service',booking_id:ref('hotelBooking','booking'),data:{kind:'stay',title:'Номер 4–7 января',state:'confirmed',validity:'date_range',date_start:'2035-01-04',date_end:'2035-01-07',start_timezone:tz,end_timezone:tz,capacity_units:1,unit_type:'room'}},
  {key:'hotelServicePlace',type:'set_service_place',expected_version:0,service_id:ref('hotelService','service'),data:{role:'lodging',place_id:'taipei-101'}},
  {key:'hotelBind',type:'set_need_service',expected_version:0,need_id:ref('hotelNeed','need'),service_id:ref('hotelService','service'),data:{allocated_units:1}},
  {key:'cancelDeadline',type:'set_deadline',expected_version:0,data:{service_id:ref('hotelService','service'),kind:'cancel_by',local_date:'2035-01-02',timezone:tz,origin:'provider',note:'Отмена до этой даты без штрафа'}},
  {key:'decision',type:'create_decision',data:{title:'Когда переезжаем в другой город?'}},
  {key:'normal',type:'add_option',decision_id:ref('decision','decision'),expected_version:1,data:{label:'Уехать 7 января',description:'Три ночи в Тайбэе, затем переезд.'}},
  {key:'early',type:'add_option',decision_id:ref('decision','decision'),expected_version:1,data:{label:'Уехать 6 января',description:'На одну ночь меньше в Тайбэе.'}}
 ]);
 f.write([{...f.change('items',ids.hotel.item,'reassign_route_owner',{decision_id:ids.decision.decision,mappings:[{placement_id:ids.hotel.placement,option_id:ids.normal.option}],reason:'Сравнить даты переезда'}),key:'owner'},f.change('decisions',ids.decision.decision,'choose_working',{option_id:ids.normal.option})]);
 const alternative=f.write([{key:'alternative',type:'add_variant_placement',item_id:ids.hotel.item,option_id:ids.early.option,expected_version:f.row('items',ids.hotel.item).version,source_placement_id:ids.hotel.placement},{key:'shorter',type:'upsert_placement',id:ref('alternative','placement'),expected_version:1,data:{date_end:'2035-01-06'}}]);
 Object.assign(ids,alternative);
 f.write([{...f.change('items',ids.ticketTask.item,'set_task_state',{state:'done'}),key:'done'},f.change('placements',ids.tower.placement,'approve_placement')]);
 return ids;
}
