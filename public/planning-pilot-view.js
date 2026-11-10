import {escapeHtml as esc} from './client-runtime.js';
import {brandPath} from './brand-mark.js';
import {addDays,itemDates,sortItems,urgency,kindLabels,priorityLabels,dateLabel,timeInZone} from './planning-model.js';
import {coversNight,stayPhase,transportModes,travelPlace} from './planning-travel.js';
import {localPoint} from './trip-timezones.js';
import {calendarDays,listDayGroups,recordCount} from './planning-pilot-model.js';

const paths={task:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 12 3 3 5-6"/>',decision:'<path d="M12 21v-8m0 0L5 6m7 7 7-7M5 10V6h4m6 0h4v4"/>',visit:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',check:'<path d="m5 12 4 4L19 6"/>',undo:'<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>'};
paths.calendar='<path d="M8 2v4m8-4v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/>';
paths.pencil='<path d="m16 3 5 5M4 15 16 3a3.5 3.5 0 0 1 5 5L9 20l-6 1 1-6Z"/>';
// Lucide outline paths. License: vendor/lucide-LICENSE.txt.
Object.assign(paths,{
 stay:'<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
 down:'<path d="M12 5v14m-7-7 7 7 7-7"/>',
 transport:'<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
 plane:'<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
 train:'<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/>',
 bus:'<path d="M4 6 2 7"/><path d="M10 6h4"/><path d="m22 7-2-1"/><rect width="16" height="16" x="4" y="3" rx="2"/><path d="M4 11h16"/><path d="M8 15h.01"/><path d="M16 15h.01"/><path d="M6 19v2"/><path d="M18 21v-2"/>',
 car:'<path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8"/><path d="M7 14h.01"/><path d="M17 14h.01"/><rect width="18" height="8" x="3" y="10" rx="2"/><path d="M5 18v2"/><path d="M19 18v2"/>',
 ship:'<path d="M12 10.189V14"/><path d="M12 2v3"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-8.188-3.639a2 2 0 0 0-1.624 0L3 14a11.6 11.6 0 0 0 2.81 7.76"/><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
 cable_car:'<path d="M10 3h.01"/><path d="M14 2h.01"/><path d="m2 9 20-5"/><path d="M12 12V6.5"/><rect width="16" height="10" x="4" y="12" rx="3"/><path d="M9 12v5"/><path d="M15 12v5"/><path d="M4 17h16"/>',
 other:'<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
});
export const pilotIcon=name=>`<svg class="planning-kind-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.task}</svg>`;
const dayLabel=(day,options={day:'numeric',month:'long'})=>new Intl.DateTimeFormat('ru',{...options,timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
const emptyMark = `<svg class="planning-empty-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <circle cx="32" cy="32" r="28"/>
  <path d="${brandPath}" transform="translate(9.6 9.6) scale(.7)"/>
</svg>`;

function transportPoint(item, side){
 const departure=side==='departure',place=travelPlace(item,side);
 const zone=departure?item.event_timezone:item.transport.arrival_timezone;
 const instant=departure?item.starts_at:item.ends_at;
 return {name:place.place_name,day:departure?item.date_start:item.date_end,
  time:instant?timeInZone(instant,zone):'',zone};
}

export function travelDetails(item){
 const row=(label,value)=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
 if(item.kind==='stay'){
  const text=(date,instant)=>[dateLabel(date),instant?timeInZone(instant,item.event_timezone):'',item.event_timezone].filter(Boolean).join(' · ');
  return `<dl class="planning-travel-details">${row('Заселение',text(item.date_start,item.starts_at))}${row('Выезд',text(item.date_end,item.ends_at))}</dl>`;
 }
 if(item.kind!=='transport')return '';
 const {mode,service_number,departure_details,arrival_details,stops}=item.transport;
 const details=(side,extra)=>{
  const {name,day,time,zone}=transportPoint(item,side);
  return [name,dateLabel(day),time,zone,extra].filter(Boolean).join(' · ');
 };
 return `<dl class="planning-travel-details">${row('Вид транспорта',[transportModes[mode],service_number].filter(Boolean).join(' · '))}
 ${row('Отправление',details('departure',departure_details))}${row('Прибытие',details('arrival',arrival_details))}
 ${stops.length?row('Остановки',stops.join(' → ')):''}</dl>`;
}

function dayOrder(records,day,zone){
 const ordered=sortItems(records);
 if(!ordered.some(item=>item.kind==='transport'))return ordered;
 function instant(item){
  if(item.kind==='transport'){
   if(day===item.date_start&&item.starts_at)return item.starts_at;
   if(day===item.date_end)return item.ends_at;
   return null;
  }
  return item.starts_at&&itemDates(item,zone)[0]===day?item.starts_at:null;
 }
 const timed=ordered.filter(instant).sort((a,b)=>Date.parse(instant(a))-Date.parse(instant(b)));
 return ordered.map(item=>instant(item)?timed.shift():item);
}

function stayBlock(records,day,allowed){
 if(!records.length)return '';
 const place=item=>travelPlace(item,'lodging');
 const row=item=>{
  const phase=stayPhase(item,day);
  const at=phase==='Заселение'?item.starts_at:phase==='Выезд'?item.ends_at:null;
  const context=[phase,at?timeInZone(at,item.event_timezone):'',item.state==='cancelled'?'Отменено':''].filter(Boolean).join(' · ');
  return `<article class="planning-card kind-stay" data-record="${esc(item.id)}" ${allowed?`data-drag-item="${esc(item.id)}" data-drag-blocked`:''}>
   <button type="button" class="planning-card-open" data-item="${esc(item.id)}"><span class="planning-card-icon">${pilotIcon('stay')}</span><span class="planning-card-body"><strong class="planning-card-title">${esc(place(item).place_name)}</strong><span class="planning-card-meta">${esc(context)}</span></span></button></article>`;
 };
 const leaving=records.filter(item=>item.date_end===day&&item.state!=='cancelled');
 const arriving=records.filter(item=>item.date_start===day&&item.state!=='cancelled');
 const [from]=leaving,[to]=arriving;
 const transfer=leaving.length===1&&arriving.length===1&&place(from).place_id&&place(to).place_id&&place(from).place_id!==place(to).place_id;
 const html=transfer?`<div class="planning-stay-transfer">${row(from)}<span class="planning-stay-direction" aria-label="Переселение">${pilotIcon('down')}</span>${row(to)}</div>`:'';
 const rest=transfer?records.filter(item=>item!==from&&item!==to):records;
 return `<section class="planning-stays" aria-label="Проживание">${html}${rest.map(row).join('')}</section>`;
}

function transportCard(item,allowed){
 const from=transportPoint(item,'departure'),to=transportPoint(item,'arrival');
 const differentDates=from.day!==to.day,{mode,service_number}=item.transport;
 const point=({name,day,time,zone})=>`<span>${esc(name)} <small title="${esc(zone)}">${esc([differentDates?dayLabel(day,{day:'numeric',month:'short'}):'',time].filter(Boolean).join(' · '))}</small></span>`;
 const routeTitle=item.title.includes('→')?'':item.title;
 const caption=[transportModes[mode],routeTitle,service_number&&!routeTitle.includes(service_number)?service_number:''].filter(Boolean).join(' · ');
 return `<article class="planning-card planning-transport kind-transport${item.state==='done'?' is-done':''}" data-record="${esc(item.id)}" ${allowed?`data-drag-item="${esc(item.id)}" data-drag-blocked`:''}>
  <button type="button" class="planning-card-open" data-item="${esc(item.id)}"><span class="planning-card-icon">${pilotIcon(mode)}</span><span class="planning-card-body">
   <strong class="planning-card-title">${esc(caption)}</strong>
   <span class="planning-transport-route">${point(from)}${pilotIcon('transport')}${point(to)}</span>
   ${item.state==='cancelled'?'<span class="planning-card-meta">Отменено</span>':''}
  </span></button></article>`;
}

export function renderPlanningPilot({view,items,plan,zone,focusDay,today,allowed,pendingId=null,listLimit=180,hasFilters=false,now=new Date()}){
 const doneLabel=item=>item.state==='done'?(item.kind==='visit'?'Состоялось':item.kind==='decision'?'Принято':'Выполнено'):item.state==='cancelled'?(item.kind==='visit'?'Пропустили':'Отменено'):item.state==='in_progress'?'В работе':'';
 const nearest=sortItems(items.filter(item=>item.kind==='visit'&&!['done','cancelled'].includes(item.state)&&(item.starts_at?Date.parse(item.ends_at||item.starts_at)>=Date.now():itemDates(item,zone)[1]>=today))).sort((a,b)=>(a.starts_at||itemDates(a,zone)[0]).localeCompare(b.starts_at||itemDates(b,zone)[0]))[0]?.id;
 function card(item,day,quick){
  const [start,end]=itemDates(item,zone),period=start&&start!==end,finished=item.state==='done',canFinish=quick&&allowed&&item.kind!=='decision'&&item.state!=='cancelled';
  const points=[item.starts_at,item.ends_at].filter(Boolean).map(at=>localPoint(at,zone));
  const time=points.map(point=>point.time+' · '+point.badge).join(' — '),assignee=plan.users.find(user=>user.id===item.assignee_id),u=urgency(item,{zone,now});
  const deadlineToday=item.kind!=='visit'&&u.kind==='current'&&end===today;
  const context=[period?dayLabel(start)+' — '+dayLabel(end):'',...new Set(item.places.map(place=>place.place_name)),assignee?.name].filter(Boolean).join(' · ');
  return `<article class="planning-card ${canFinish?'has-action':''} ${finished?'is-done':''} kind-${item.kind}" data-record="${esc(item.id)}" data-anchor-day="${day||''}" ${allowed?`data-drag-item="${esc(item.id)}" ${period?'data-drag-blocked':''}`:''} ${pendingId===item.id?'aria-busy="true"':''}>
   <button type="button" class="planning-card-open" data-item="${esc(item.id)}"><span class="planning-card-icon">${pilotIcon(item.kind)}</span><span class="planning-card-body">
   ${quick&&item.id===nearest?'<span class="planning-card-next">Ближайшее посещение</span>':''}<strong class="planning-card-title">${esc(item.title)}</strong>
   <span class="planning-card-meta">${esc([time||'Без точного времени',kindLabels[item.kind]].join(' · '))}${doneLabel(item)?` · <span class="ui-status" data-state="${esc(item.state)}">${esc(doneLabel(item))}</span>`:''}</span>
   ${context?`<span class="planning-card-meta">${esc(context)}</span>`:''}
   ${u.kind==='overdue'||deadlineToday||item.priority!=='normal'?`<span class="planning-card-meta planning-card-signals">${u.kind==='overdue'?`<span class="ui-status ui-status--danger">${esc(u.label)}</span>`:deadlineToday?'<span class="ui-status ui-status--warning">Срок сегодня</span>':''}${item.priority!=='normal'?`<span class="${item.priority==='critical'?'ui-status ui-status--danger':item.priority==='high'?'ui-status ui-status--warning':''}">${esc(priorityLabels[item.priority])} приоритет</span>`:''}</span>`:''}</span></button>
   ${canFinish?`<button type="button" class="ui-button planning-finish ${finished?'ui-button--soft':'ui-button--success'}" data-quick-complete="${esc(item.id)}" aria-label="${finished?'Вернуть в план':'Готово'}: ${esc(item.title)}" ${pendingId?'disabled':''}>${pilotIcon(finished?'undo':'check')}<span>${finished?'Вернуть':'Готово'}</span></button>`:''}</article>`;
 }
 const cards=(records,day,quick=false)=>{
  const stays=records.filter(item=>item.kind==='stay'),others=dayOrder(records.filter(item=>item.kind!=='stay'),day,zone);
  return stayBlock(stays,day,allowed)+(others.length?`<div class="planning-items">${others.map(item=>item.kind==='transport'?transportCard(item,allowed):card(item,day,quick)).join('')}</div>`:'');
 };
 function empty(whole=false){
  const showMark = !hasFilters && (!whole || items.length === 0);
  const title = hasFilters ? 'Ничего не нашлось' : whole ? 'Поездка начинается с первого плана' : 'Этот день пока свободен';
  const description = hasFilters ? 'Попробуйте изменить фильтры или поиск.' :
   whole ? 'Добавьте первую запись в план поездки.' : 'Можно добавить прогулку, задачу или оставить время для спонтанных планов.';
  const action = hasFilters ? '<button class="ui-button ui-button--quiet" data-clear-filters>Сбросить фильтры</button>' :
   allowed ? `<button class="ui-button ui-button--primary" data-new-day="${whole?today:focusDay}">Добавить запись</button>` : '';
  return `<div class="planning-empty">${showMark ? emptyMark : ''}<h3>${title}</h3><p>${description}</p>${action}</div>`;
 }
 const undated=items.filter(item=>!itemDates(item,zone)[0]);
 const undatedHtml=quick=>undated.length?`<section class="planning-undated ${quick?'planning-day-group':''}"><div class="planning-undated-heading"><h3>Без даты · ${undated.length}</h3><span class="muted">Можно распределить по дням</span></div>${quick?'<div class="planning-drop-items">':''}${cards(undated,null,quick)}${quick?'</div>':''}</section>`:'';
 if(view==='month'){
  const days=calendarDays(focusDay,items,zone),selected=days.find(day=>day.date===focusDay)?.items||[];
  const stays=(plan.items||items).filter(item=>item.kind==='stay');
  return `<div class="planning-month-layout" style="--planning-week-count:${days.length/7}"><section class="planning-month-panel" aria-label="Календарь месяца"><div class="planning-month-grid">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(day=>`<span class="planning-weekday">${day}</span>`).join('')}${Array.from({length:42},(_,index)=>days[index]||{date:'',items:[]}).map(({date,items:records})=>{const night=date&&stays.some(item=>coversNight(item,date));return `<button type="button" class="planning-calendar-day ui-button-feedback ${date.slice(0,7)!==focusDay.slice(0,7)?'other-month':''} ${date>=plan.trip.start_date&&date<=plan.trip.end_date?'is-trip':''}" ${date?'':'hidden'} data-day="${date}" data-drop-day="${date}" aria-pressed="${date===focusDay}" ${date===today?'aria-current="date"':''} aria-label="${date?esc(dayLabel(date)):''}, ${recordCount(records.length)}${date===today?', сегодня':''}${night?', есть проживание на ночь':''}"><span class="planning-day-number">${Number(date.slice(-2))}</span><span class="planning-day-indicators"><span class="planning-day-count" data-empty="${!records.length}" data-count="${records.length}" aria-hidden="true">${recordCount(records.length)}</span><span class="planning-day-dots" aria-hidden="true">${[0,1,2].map(n=>`<span ${n<records.length?'':'hidden'}></span>`).join('')}</span>${night?`<span class="planning-day-stay" aria-hidden="true">${pilotIcon('stay')}<svg class="planning-day-house-small" viewBox="0 0 7 7" aria-hidden="true"><path d="M0 3.5 3.5 0 7 3.5H6V7H1V3.5Z" fill="currentColor" stroke="none"/></svg></span>`:''}</span></button>`}).join('')}</div><p class="planning-month-legend">Дни поездки · ${esc(dayLabel(plan.trip.start_date))} — ${esc(dayLabel(plan.trip.end_date))}</p></section>
  <div class="planning-agenda"><div class="planning-agenda-heading"><h2>${esc(dayLabel(focusDay))}</h2></div><div class="planning-day-panel" data-planning-scroller="month" tabindex="0" aria-label="Записи выбранного дня и без даты"><section class="planning-selected-day" data-drop-day="${focusDay}">${selected.length?cards(selected,focusDay):empty()}</section>${undatedHtml(false)}</div></div></div>`;
 }
 const {groups,hasMore}=listDayGroups(items,zone,focusDay,listLimit,today);
 const hasDatedItems=items.some(item=>itemDates(item,zone)[0]);
 const dayGroups=groups.map(({date,items:records})=>{
  const isToday=date===today,weekday=date===addDays(today,1)?'Завтра':esc(dayLabel(date,{weekday:'short'}));
  const emptyDay=isToday&&!hasDatedItems?empty(true):
   `<p class="planning-drop-empty">${isToday?'На сегодня записей нет':`Перенести на ${esc(dayLabel(date))}`}</p>`;
  return `<section class="planning-day-group${records.length||isToday?'':' planning-empty-day'}" data-drop-day="${date}" ${isToday?'data-list-today':''}>
   <div class="planning-day-stamp">
    <h2 class="planning-day-date"${isToday?` tabindex="-1" aria-current="date" aria-label="Сегодня, ${esc(dayLabel(date))}"`:''}>
     <span>${isToday?'Сегодня':weekday}</span><strong>${Number(date.slice(-2))}</strong><span>${esc(dayLabel(date,{month:'short'}))}${date.slice(0,4)!==today.slice(0,4)?' '+date.slice(0,4):''}</span>
    </h2>
    <button type="button" class="ui-button ui-button--quiet ui-button--compact" data-calendar-day="${date}" aria-label="${esc(dayLabel(date))} в календаре">К дате</button>
   </div>
   <div class="planning-drop-items">${records.length?cards(records,date,true):emptyDay}</div>
  </section>`;
 }).join('');
 return `<div class="planning-itinerary" data-planning-scroller="list" tabindex="0" aria-label="Список по дням"><div class="planning-itinerary-content">
  ${dayGroups}${hasMore?'<button class="ui-button ui-button--quiet" data-more-days>Показать следующие дни</button>':''}${undatedHtml(true)}
 </div></div>`;
}
