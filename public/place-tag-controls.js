import {tagDefinitions,tagIcon,mergeTags} from './place-tags.js';

export function tagsPatch(original,draft){
 const patch={};
 if(original.photoSpot!==draft.photoSpot)patch.photoSpot=draft.photoSpot;
 for(const name of ['limitedDates','reservation']){const fields={};for(const key of Object.keys(draft[name]))if(original[name][key]!==draft[name][key])fields[key]=draft[name][key];if(Object.keys(fields).length)patch[name]=fields}
 return patch;
}
export function tagEditorContent(esc){return `<form id="place-tags-form" class="tag-editor"><h3>Дополнительные ярлыки</h3><div class="chips tag-switches" role="group" aria-label="Дополнительные ярлыки">${tagDefinitions.map(t=>`<label class="chip"><input type="checkbox" name="${t.id}">${tagIcon(t.icon)}<span>${esc(t.filterLabel||t.label)}</span></label>`).join('')}</div><fieldset data-tag-fields="limitedDates" hidden><legend>Даты и расписание</legend><div class="tag-date-fields"><label>Дата начала<input type="date" name="startDate"></label><label>Дата окончания<input type="date" name="endDate"></label></div><label>Дополнительное расписание<textarea name="scheduleText" maxlength="2000" placeholder="Особые дни и часы, до 2000 символов"></textarea></label><p class="muted">Даты и текст необязательны. День окончания входит в период; даты проверяются по времени Тайваня.</p></fieldset><fieldset data-tag-fields="reservation" hidden><legend>Бронирование</legend><label>Ссылка на бронирование<input type="url" name="bookingUrl" maxlength="1024" placeholder="https://…"></label><p class="muted">Можно оставить пустой. Поддерживаются HTTP и HTTPS.</p></fieldset><button type="submit" class="primary tag-save" disabled>Сохранить ярлыки</button></form>`}

export function createPlaceTagControls({root,place,api,esc,toast,onDirty,onBusy,onChange,canSave=()=>true}){
 let baseline=mergeTags(undefined,place.tags||{}),saving=false;
 root.innerHTML=tagEditorContent(esc);
 const form=root.querySelector('form'),field=name=>form.elements.namedItem(name),save=form.querySelector('[type=submit]');
 function read(){return {photoSpot:field('photoSpot').checked,limitedDates:{enabled:field('limitedDates').checked,startDate:field('startDate').value,endDate:field('endDate').value,scheduleText:field('scheduleText').value},reservation:{enabled:field('reservation').checked,url:field('bookingUrl').value.trim()}}}
 function write(tags){field('photoSpot').checked=tags.photoSpot;field('limitedDates').checked=tags.limitedDates.enabled;field('reservation').checked=tags.reservation.enabled;for(const name of ['startDate','endDate','scheduleText'])field(name).value=tags.limitedDates[name];field('bookingUrl').value=tags.reservation.url}
 function update(){
  for(const t of tagDefinitions)field(t.id).closest('label').classList.toggle('active',field(t.id).checked);
  for(const name of ['limitedDates','reservation']){const fields=form.querySelector(`[data-tag-fields="${name}"]`);fields.hidden=!field(name).checked;fields.disabled=saving||!field(name).checked}
  const changed=Object.keys(tagsPatch(baseline,read())).length>0;save.disabled=saving||!changed;onDirty(changed);
 }
 write(baseline);form.oninput=update;form.onchange=update;update();
 form.onsubmit=async event=>{
  event.preventDefault();if(saving)return;if(!canSave()){toast('Дождитесь завершения сохранения.');return}
  let patch;try{patch=tagsPatch(baseline,mergeTags(undefined,read()))}catch(error){toast(error.message);return}
  if(!Object.keys(patch).length)return;
  saving=true;onBusy(true);form.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=true);
  let changed=false;
  try{
   const result=await api(`/api/places/${encodeURIComponent(place.id)}/tags`,{method:'PUT',body:JSON.stringify({version:place.tags_version,tags:patch})});
   Object.assign(place,result);baseline=mergeTags(undefined,result.tags);write(baseline);changed=true;toast('Ярлыки сохранены.');
  }catch(error){
   toast(error.message);
   if(error.status===409)try{
    const latest=await api('/api/data'),current=latest.places.find(p=>p.id===place.id);
    if(current){place.tags_version=current.tags_version;place.tags=current.tags;toast('Ярлыки изменили на другом устройстве. Ваши поля сохранены: проверьте и сохраните ещё раз.')}
   }catch(refreshError){toast(refreshError.message)}
  }finally{
   saving=false;form.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=false);update();onBusy(false);if(changed)onChange();
  }
 };
 return {snapshot(){return {baseline:structuredClone(baseline),draft:read()}},restore(snapshot){baseline=snapshot.baseline;write(snapshot.draft);update()}};
}
