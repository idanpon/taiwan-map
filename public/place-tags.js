// Lucide 0.468.0 paths, ISC license: vendor/lucide-LICENSE.txt. No runtime icon service.
const shapes={"camera": "<path d=\"M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z\" />\n  <circle cx=\"12\" cy=\"13\" r=\"3\" />", "calendar-clock": "<path d=\"M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5\" />\n  <path d=\"M16 2v4\" />\n  <path d=\"M8 2v4\" />\n  <path d=\"M3 10h5\" />\n  <path d=\"M17.5 17.5 16 16.3V14\" />\n  <circle cx=\"16\" cy=\"16\" r=\"6\" />", "ticket": "<path d=\"M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z\" />\n  <path d=\"M13 5v2\" />\n  <path d=\"M13 17v2\" />\n  <path d=\"M13 11v2\" />", "external-link": "<path d=\"M15 3h6v6\" />\n  <path d=\"M10 14 21 3\" />\n  <path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\" />", "chevron-down": "<path d=\"m6 9 6 6 6-6\" />", "chevron-up": "<path d=\"m18 15-6-6-6 6\" />"};
export function tagIcon(name){return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${shapes[name]||''}</svg>`}
export const tagDefinitions=Object.freeze([
 {id:'photoSpot',label:'Фотоспот',icon:'camera',tooltip:'Хорошее место для фотографий',description:'Место, где особенно интересно фотографироваться.'},
 {id:'limitedDates',label:'Ограничено по датам',filterLabel:'По датам',icon:'calendar-clock',tooltip:'Ограничено по датам',description:'Место с ограниченными датами посещения или специальным расписанием.'},
 {id:'reservation',label:'Нужна бронь',icon:'ticket',tooltip:'Нужна предварительная бронь',description:'Рекомендуется или требуется бронирование заранее.'}
].map(Object.freeze));
export function emptyTags(){return {photoSpot:false,limitedDates:{enabled:false,startDate:'',endDate:'',scheduleText:''},reservation:{enabled:false,url:''}}}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
function keys(value,allowed){if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw new Error('Некорректные поля ярлыков.')}
export function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1000-01-01')return false;const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value}
export function bookingUrl(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:''}catch{return ''}}
// Nested patches preserve unrelated fields, including data behind disabled switches.
export function mergeTags(current,patch){
 const result=emptyTags();
 if(current!==undefined){keys(current,['photoSpot','limitedDates','reservation']);Object.assign(result,current);result.limitedDates={...emptyTags().limitedDates,...current.limitedDates};result.reservation={...emptyTags().reservation,...current.reservation}}
 keys(patch,['photoSpot','limitedDates','reservation']);
 if('photoSpot' in patch)result.photoSpot=patch.photoSpot;
 for(const [name,allowed] of [['limitedDates',['enabled','startDate','endDate','scheduleText']],['reservation',['enabled','url']]])if(name in patch){keys(patch[name],allowed);Object.assign(result[name],patch[name])}
 if(typeof result.photoSpot!=='boolean'||typeof result.limitedDates.enabled!=='boolean'||typeof result.reservation.enabled!=='boolean')throw new Error('Ярлык должен быть включён или выключен.');
 const dates=result.limitedDates;
 for(const name of ['startDate','endDate'])if(typeof dates[name]!=='string'||(dates[name]&&!validDate(dates[name])))throw new Error('Укажите корректные даты в формате ГГГГ-ММ-ДД.');
 if(dates.startDate&&dates.endDate&&dates.startDate>dates.endDate)throw new Error('Дата окончания не может быть раньше даты начала.');
 if(typeof dates.scheduleText!=='string'||dates.scheduleText.length>2000)throw new Error('Расписание: до 2000 символов.');
 const url=result.reservation.url;
 if(typeof url!=='string'||url.length>1024||(url&&!bookingUrl(url)))throw new Error('Ссылка на бронирование: HTTP или HTTPS, до 1024 символов, без логина и пароля.');
 return result;
}
export function readTags(json){return mergeTags(undefined,json?JSON.parse(json):{})}
export function hasTag(tags,id){return id==='photoSpot'?tags?.photoSpot===true:tags?.[id]?.enabled===true}
export function matchesTags(tags,selected){return !selected.size||tagDefinitions.some(t=>selected.has(t.id)&&hasTag(tags,t.id))}
export function taipeiDay(now=new Date()){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);const part=type=>parts.find(x=>x.type===type).value;return `${part('year')}-${part('month')}-${part('day')}`}
export function eventEnded(tags,now=new Date()){const d=tags?.limitedDates;return Boolean(d?.enabled&&validDate(d.endDate||'')&&d.endDate<taipeiDay(now))}
function dateLabel(value){return value.split('-').reverse().join('.')}
export function tagsHeading(tags,esc){const active=tagDefinitions.filter(t=>hasTag(tags,t.id));return active.length?`<span class="place-tags" aria-label="Дополнительные ярлыки">${active.map(t=>`<button type="button" class="place-tag" data-tag-info="${t.id}" title="${esc(t.tooltip)}" aria-label="${esc(t.tooltip)}">${tagIcon(t.icon)}</button>`).join('')}</span>`:''}
export function tagsDetails(tags,esc,now=new Date()){
 const d=tags?.limitedDates,r=tags?.reservation;
 const period=d?.startDate&&d?.endDate?`${dateLabel(d.startDate)} — ${dateLabel(d.endDate)}`:d?.startDate?`С ${dateLabel(d.startDate)}`:d?.endDate?`До ${dateLabel(d.endDate)}`:'';
 return `${d?.enabled?`<section class="tag-details" aria-label="Даты и расписание"><h3>Даты и расписание</h3>${period?`<p>${esc(period)}</p>`:''}${eventEnded(tags,now)?'<p class="event-ended">Событие завершилось</p>':''}${d.scheduleText?`<details class="place-schedule"><summary><span class="schedule-show">Показать расписание ${tagIcon('chevron-down')}</span><span class="schedule-hide">Скрыть расписание ${tagIcon('chevron-up')}</span></summary><p class="schedule-text">${esc(d.scheduleText)}</p></details>`:!period?'<p class="muted">Даты и расписание пока не уточнены.</p>':''}</section>`:''}${r?.enabled?`<section class="tag-details" aria-label="Бронирование">${r.url&&bookingUrl(r.url)?`<a class="booking-link" href="${esc(bookingUrl(r.url))}" target="_blank" rel="noopener noreferrer">Забронировать ${tagIcon('external-link')}</a>`:'<p class="muted">Для посещения может потребоваться предварительная бронь.</p>'}</section>`:''}`;
}
