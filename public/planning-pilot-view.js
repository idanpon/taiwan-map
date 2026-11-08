import {escapeHtml as esc} from './client-runtime.js';
import {brandPath} from './brand-mark.js';
import {addDays,itemDates,sortItems,urgency,kindLabels,priorityLabels} from './planning-model.js';
import {localPoint} from './trip-timezones.js';
import {calendarDays,listDayGroups,recordCount} from './planning-pilot-model.js';

const paths={task:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 12 3 3 5-6"/>',decision:'<path d="M12 21v-8m0 0L5 6m7 7 7-7M5 10V6h4m6 0h4v4"/>',visit:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',check:'<path d="m5 12 4 4L19 6"/>',undo:'<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>'};
paths.calendar='<path d="M8 2v4m8-4v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/>';
paths.pencil='<path d="m16 3 5 5M4 15 16 3a3.5 3.5 0 0 1 5 5L9 20l-6 1 1-6Z"/>';
export const pilotIcon=name=>`<svg class="planning-kind-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.task}</svg>`;
const dayLabel=(day,options={day:'numeric',month:'long'})=>new Intl.DateTimeFormat('ru',{...options,timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
const emptyMark = `<svg class="planning-empty-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <circle cx="32" cy="32" r="28"/>
  <path d="${brandPath}" transform="translate(9.6 9.6) scale(.7)"/>
</svg>`;

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
 const cards=(records,day,quick=false)=>`<div class="planning-items">${sortItems(records).map(item=>card(item,day,quick)).join('')}</div>`;
 function empty(whole=false){
  const showMark = !hasFilters && (!whole || items.length === 0);
  const title = hasFilters ? 'Ничего не нашлось' : whole ? 'Поездка начинается с первого плана' : 'Этот день пока свободен';
  const description = hasFilters ? 'Попробуйте изменить фильтры или поиск.' :
   whole ? 'Добавьте место, задачу или решение.' : 'Можно добавить прогулку, задачу или оставить время для спонтанных планов.';
  const action = hasFilters ? '<button class="ui-button ui-button--quiet" data-clear-filters>Сбросить фильтры</button>' :
   allowed ? `<button class="ui-button ui-button--primary" data-new-day="${whole?today:focusDay}">Добавить запись</button>` : '';
  return `<div class="planning-empty">${showMark ? emptyMark : ''}<h3>${title}</h3><p>${description}</p>${action}</div>`;
 }
 const undated=items.filter(item=>!itemDates(item,zone)[0]);
 const undatedHtml=quick=>undated.length?`<section class="planning-undated ${quick?'planning-day-group':''}"><div class="planning-undated-heading"><h3>Без даты · ${undated.length}</h3><span class="muted">Можно распределить по дням</span></div>${quick?'<div class="planning-drop-items">':''}${cards(undated,null,quick)}${quick?'</div>':''}</section>`:'';
 if(view==='month'){
  const days=calendarDays(focusDay,items,zone),selected=days.find(day=>day.date===focusDay)?.items||[];
  return `<div class="planning-month-layout" style="--planning-week-count:${days.length/7}"><section class="planning-month-panel" aria-label="Календарь месяца"><div class="planning-month-grid">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(day=>`<span class="planning-weekday">${day}</span>`).join('')}${Array.from({length:42},(_,index)=>days[index]||{date:'',items:[]}).map(({date,items:records})=>`<button type="button" class="planning-calendar-day ui-button-feedback ${date.slice(0,7)!==focusDay.slice(0,7)?'other-month':''} ${date>=plan.trip.start_date&&date<=plan.trip.end_date?'is-trip':''}" ${date?'':'hidden'} data-day="${date}" data-drop-day="${date}" aria-pressed="${date===focusDay}" ${date===today?'aria-current="date"':''} aria-label="${date?esc(dayLabel(date)):''}, ${recordCount(records.length)}${date===today?', сегодня':''}"><span class="planning-day-number">${Number(date.slice(-2))}</span><span class="planning-day-count" data-empty="${!records.length}" data-count="${records.length}" aria-hidden="true">${recordCount(records.length)}</span><span class="planning-day-dots" aria-hidden="true">${[0,1,2].map(n=>`<span ${n<records.length?'':'hidden'}></span>`).join('')}</span></button>`).join('')}</div><p class="planning-month-legend">Дни поездки · ${esc(dayLabel(plan.trip.start_date))} — ${esc(dayLabel(plan.trip.end_date))}</p></section>
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
