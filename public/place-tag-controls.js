import {tagDefinitions,tagIcon,mergeTags} from './place-tags.js';

export function tagsPatch(original,draft){
 const patch={};
 if(original.photoSpot!==draft.photoSpot)patch.photoSpot=draft.photoSpot;
 for(const name of ['limitedDates','reservation']){const fields={};for(const key of Object.keys(draft[name]))if(original[name][key]!==draft[name][key])fields[key]=draft[name][key];if(Object.keys(fields).length)patch[name]=fields}
 return patch;
}
export function tagEditorContent(esc){return `<section id="place-tags-fields" class="tag-editor"><h3>Дополнительные ярлыки</h3><div class="chips tag-switches" role="group" aria-label="Дополнительные ярлыки">${tagDefinitions.map(t=>`<label class="chip"><input type="checkbox" name="${t.id}">${tagIcon(t.icon)}<span>${esc(t.filterLabel||t.label)}</span></label>`).join('')}</div><fieldset data-tag-fields="limitedDates" hidden><legend>Даты и расписание</legend><div class="tag-date-fields"><label>Дата начала<input type="date" name="startDate"></label><label>Дата окончания<input type="date" name="endDate"></label></div><details class="schedule-editor"><summary>Дополнительное расписание ${tagIcon('chevron-down')}</summary><label>Особые дни и часы<textarea name="scheduleText" maxlength="2000" placeholder="Необычное расписание, до 2000 символов"></textarea></label></details><p class="muted">Даты и текст необязательны. День окончания входит в период; даты проверяются по времени Тайваня.</p></fieldset><fieldset data-tag-fields="reservation" hidden><legend>Бронирование</legend><label>Ссылка на бронирование<input type="url" name="bookingUrl" maxlength="1024" placeholder="https://…"></label><p class="muted">Можно оставить пустой. Поддерживаются HTTP и HTTPS.</p></fieldset></section>`}

// Fields belong to the card's single form; saving is coordinated by app.js.
export function createPlaceTagControls({root,place,esc,onDirty}){
 let baseline=mergeTags(undefined,place.tags||{}),saving=false;
 root.innerHTML=tagEditorContent(esc);
 const field=name=>root.querySelector(`[name="${name}"]`),schedule=root.querySelector('.schedule-editor');
 function read(){return {photoSpot:field('photoSpot').checked,limitedDates:{enabled:field('limitedDates').checked,startDate:field('startDate').value,endDate:field('endDate').value,scheduleText:field('scheduleText').value},reservation:{enabled:field('reservation').checked,url:field('bookingUrl').value.trim()}}}
 function write(tags){field('photoSpot').checked=tags.photoSpot;field('limitedDates').checked=tags.limitedDates.enabled;field('reservation').checked=tags.reservation.enabled;for(const name of ['startDate','endDate','scheduleText'])field(name).value=tags.limitedDates[name];field('bookingUrl').value=tags.reservation.url}
 function update(){
  for(const t of tagDefinitions)field(t.id).closest('label').classList.toggle('active',field(t.id).checked);
  for(const name of ['limitedDates','reservation']){const fields=root.querySelector(`[data-tag-fields="${name}"]`);fields.hidden=!field(name).checked;fields.disabled=saving||!field(name).checked}
  onDirty(Object.keys(tagsPatch(baseline,read())).length>0);
 }
 write(baseline);root.oninput=update;root.onchange=update;update();
 return {
  patch(){return tagsPatch(baseline,mergeTags(undefined,read()))},
  commit(tags){baseline=mergeTags(undefined,tags||{});write(baseline);update()},
  setBusy(value){saving=value;root.querySelectorAll('input,textarea').forEach(el=>el.disabled=value);update()},
  snapshot(){return {baseline:structuredClone(baseline),draft:read(),scheduleOpen:schedule.open}},
  restore(snapshot){baseline=snapshot.baseline;write(snapshot.draft);schedule.open=Boolean(snapshot.scheduleOpen);update()}
 };
}
