import {installDialogBackdrop} from './dialogs.js';
import {installSheetSwipe} from './sheet-swipe.js';
import {planningConflictContent} from './planning-links.js';

export function installMapMarkerHold(surface,{enabled,onHold}){
 let press=null;

 surface.addEventListener('touchstart',event=>{
  press=null;
  if(event.touches.length!==1||!enabled())return;
  const marker=event.target.closest('[data-map-place]');
  if(!marker)return;
  const {identifier,clientX,clientY}=event.touches[0];
  press={marker,identifier,clientX,clientY,time:event.timeStamp};
 },{passive:true});

 function moved(touch,start){
  return Math.hypot(touch.clientX-start.clientX,touch.clientY-start.clientY)>8;
 }

 surface.addEventListener('touchmove',event=>{
  if(press&&(event.touches.length!==1||moved(event.touches[0],press)))press=null;
 },{passive:true});
 surface.addEventListener('touchcancel',()=>{press=null},{passive:true});
 surface.addEventListener('contextmenu',event=>{
  if(press?.marker.contains(event.target))event.preventDefault();
 });
 surface.addEventListener('touchend',event=>{
  const start=press;
  press=null;
  if(!start||event.touches.length||event.timeStamp-start.time<500)return;
  const touch=Array.from(event.changedTouches).find(value=>value.identifier===start.identifier);
  if(!touch||moved(touch,start)||!start.marker.isConnected||!enabled())return;
  if(event.cancelable)event.preventDefault();
  onHold(start.marker.dataset.mapPlace);
 },{capture:true,passive:false});
}

export function createMapStatusMenu({esc,onSelect}){
 const dialog=document.createElement('dialog');
 dialog.className='ui-panel ui-overlay ui-sheet map-status-menu';
 dialog.setAttribute('aria-labelledby','map-status-menu-title');
 dialog.innerHTML=`<div class="ui-overlay-heading">
  <h2 class="ui-overlay-title" id="map-status-menu-title" tabindex="-1"></h2>
  <button type="button" class="ui-overlay-close ui-button ui-button--quiet ui-button--icon" aria-label="Закрыть">×</button>
 </div><div class="ui-overlay-body">
  <div class="ui-list" role="group" aria-label="Статус места"></div>
  <div class="ui-error" role="alert"></div>
 </div>`;
 document.body.append(dialog);
 const title=dialog.querySelector('h2');
 const choices=dialog.querySelector('.ui-list');
 const feedback=dialog.querySelector('[role=alert]');
 const closeButton=dialog.querySelector('.ui-overlay-close');
 let placeId,saving=false;

 installDialogBackdrop(dialog,{canClose:()=>!saving});
 const swipe=installSheetSwipe({
  card:dialog,document,enabled:()=>dialog.open&&!saving,close:()=>dialog.close()
 });
 dialog.addEventListener('close',swipe.cancel);
 dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault()});
 closeButton.onclick=()=>{if(!saving)dialog.close()};
 choices.onclick=event=>{
  const choice=event.target.closest('[data-status]');
  if(choice&&!saving)void onSelect(placeId,choice.dataset.status||null);
 };

 function setSaving(value){
  saving=value;
  dialog.querySelectorAll('button').forEach(button=>{button.disabled=value});
  if(value)choices.setAttribute('aria-busy','true');
  else choices.removeAttribute('aria-busy');
 }

 function update(place,statuses){
  placeId=place.id;
  title.textContent=place.name;
  const options=[...statuses,{id:null,label:'Без статуса'}];
  choices.innerHTML=options.map(({id,label})=>`<button type="button" class="ui-list-item" data-status="${esc(id||'')}" aria-pressed="${id===(place.status_id??null)}">${esc(label)}</button>`).join('');
  setSaving(saving);
 }

 return {
  open(place,statuses){
   feedback.replaceChildren();
   update(place,statuses);
   dialog.showModal();
   title.focus({preventScroll:true});
  },
  close:()=>dialog.close(),
  update,setSaving,
  showError(error){
   feedback.textContent=error.message;
   if(error.details?.code==='planning_decision_required'){
    feedback.innerHTML=planningConflictContent(error.details,esc);
   }
  }
 };
}
