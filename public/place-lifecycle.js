import {installDialogBackdrop} from './dialogs.js';
export function createPlaceLifecycleUI({api,$,esc,getData,onChange,canOpen,canChange,toast,onBusy=()=>{}}){
 let hidden=[],busy=false,loading=false,sequence=0;
 const dialog=$('hidden-places-dialog');
 installDialogBackdrop(dialog,{canClose:()=>!busy});
 const allowed=()=>['admin','editor'].includes(getData()?.user.role);
 function render(){
  const bulk=$('hidden-delete-all');if(bulk){bulk.hidden=loading||!hidden.length;bulk.disabled=busy;bulk.textContent='Удалить всё · '+hidden.length;}
  $('hidden-places-list').innerHTML=loading?'<p class="muted">Загрузка скрытых мест…</p>':hidden.length?hidden.map(p=>{
   const category=getData()?.categories.find(c=>c.id===p.category_id),status=getData()?.statuses.find(s=>s.id===p.status_id);
   return `<article class="hidden-place" data-hidden-place="${esc(p.id)}"><h3>${esc(p.name)}</h3><p class="muted">${esc(p.city)} · ${esc(category?.label||'')}</p>${status?`<p>Статус: ${esc(status.label)}</p>`:''}${p.note?`<p class="hidden-place-note">${esc(p.note)}</p>`:''}<a target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name+' '+p.address)}">Открыть в Google Maps ↗</a><div class="place-actions"><button type="button" class="primary" data-restore-place ${busy?'disabled':''}>Вернуть на карту</button><button type="button" class="text-button" data-delete-place ${busy?'disabled':''}>Удалить</button></div></article>`;
  }).join(''):'<p class="muted">Скрытых мест нет.</p>';
 }
 async function refresh(){
  const current=++sequence;loading=true;render();
  try{const value=await api('/api/places/hidden');if(current===sequence&&getData())hidden=value.places}
  finally{if(current===sequence){loading=false;if(getData())render()}}
 }
 async function change(place,action){
  if(!allowed()||busy||loading)return;
  const permanent=action==='delete',question=permanent?`Удалить «${place.name}»? Место, его статусы, заметки и история будут удалены для всех участников. Восстановить их в приложении нельзя. Связанные задачи календаря сохранятся.`:null;
  if(!canChange(place,question))return;
  busy=true;onBusy(true);$('hidden-places-error').textContent='';if(dialog.open)render();
  for(const button of $('detail').querySelectorAll('[data-place-action]'))button.disabled=true;
  try{
   const saved=await api('/api/places/'+encodeURIComponent(place.id)+(permanent?'':'/visibility'),{method:permanent?'DELETE':'PUT',body:JSON.stringify({version:place.visibility_version,...(permanent?{}:{hidden:action==='hide'})})});
   Object.assign(place,saved);hidden=hidden.filter(p=>p.id!==place.id);await onChange(place,action);if(dialog.open)await refresh();
   toast(permanent?'Место удалено.':action==='hide'?'Место скрыто. Вернуть его можно из раздела «Скрытые места».':'Место возвращено на карту.');
  }catch(error){
   if(dialog.open)$('hidden-places-error').textContent=error.message;else toast(error.message);
   if(dialog.open&&[404,409].includes(error.status))try{await refresh()}catch{}
  }finally{busy=false;onBusy(false);if(dialog.open&&getData())render();for(const button of $('detail').querySelectorAll('[data-place-action]'))button.disabled=false}
 }
 $('hidden-places-open').onclick=async()=>{
  if(!allowed()||!canOpen()||busy)return;
  $('hidden-places-error').textContent='';dialog.showModal();$('hidden-places-title').focus({preventScroll:true});
  try{await refresh()}catch(error){$('hidden-places-error').textContent=error.message}
 };
 if($('hidden-delete-all'))$('hidden-delete-all').onclick=async()=>{
  if(!allowed()||busy||loading||!hidden.length||!canOpen())return;
  const places=hidden.map(p=>({id:p.id,version:p.visibility_version}));
  if(!window.confirm('Удалить все скрытые места — '+places.length+' шт.? Места и заметки будут удалены. Связанные задачи календаря сохранятся. Восстановить места в приложении нельзя.'))return;
  busy=true;onBusy(true);render();
  try{await api('/api/places/hidden/delete-all',{method:'POST',body:JSON.stringify({places})});hidden=[];toast('Удалено мест: '+places.length);await refresh()}
  catch(error){$('hidden-places-error').textContent=error.message;if(error.status===409)await refresh()}
  finally{busy=false;onBusy(false);render()}
 };
 $('hidden-places-close').onclick=()=>{if(!busy)dialog.close()};
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault()});
 $('hidden-places-list').onclick=event=>{
  const row=event.target.closest('[data-hidden-place]'),button=event.target.closest('button');if(!row||!button)return;
  const place=hidden.find(p=>p.id===row.dataset.hiddenPlace);if(place)void change(place,button.hasAttribute('data-restore-place')?'restore':'delete');
 };
 return {hide:place=>change(place,'hide'),remove:place=>change(place,'delete'),close(){sequence++;hidden=[];loading=false;dialog.close()}};
}
