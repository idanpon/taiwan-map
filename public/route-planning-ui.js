import {escapeHtml as esc} from './client-runtime.js';
import {installDialogBackdrop} from './dialogs.js';
import {installSwipeGesture} from './swipe-gesture.js';
import {installSheetSwipe} from './sheet-swipe.js';
import {routeHtml,preparationHtml,btn,link,section,issuesHtml} from './route-planning-view.js';
import {byId,activeRows,viewedModel,commandVersionTarget} from './route-planning-model.js';
import {detail,registry} from './route-planning-details.js';
import {createRouteEditors} from './route-planning-editors.js';
import {presentChanges,sourceLabels,labelFor,when,issueText,collectionLabels} from './planning-presentation.js';
import {reminderCard} from './planning-reminders-ui.js';
import {createTimeReview} from './planning-time-ui.js';
import {derivePlanning} from './planning-projection.js';
import {addDays} from './planning-model.js';
import {values} from './route-planning-forms.js';

// One snapshot and one command path for every structural writer in this screen.
export function createRoutePlanningUI({canvas,api,getUsers,getZone,notifications,openSettings,onRefresh,onDay,onMonth,toast,onState}){
 let model=null,allowed=false,display={},choices={},prepMode='trip',busy=false,dirty=false,current=null,stack=[],draft=null,epoch=0,reminder=null,refreshTimer=null;
 const savedScroll={month:0,list:0},fileNames=new Map();
 const makeDialog=(id,title)=>{const d=document.createElement('dialog');d.id=id;d.className='ui-panel ui-overlay ui-sheet route-sheet';d.setAttribute('aria-labelledby',id+'-title');d.innerHTML=`<header class="ui-overlay-heading"><button type="button" class="ui-button ui-button--quiet ui-button--compact" data-route-back>Назад</button><h2 id="${id}-title" tabindex="-1">${title}</h2><button type="button" class="ui-button ui-button--quiet ui-button--compact" data-route-close aria-label="Закрыть">×</button></header><div class="ui-overlay-body"><div data-route-content></div><p class="ui-error" data-route-error role="alert"></p></div>`;document.body.append(d);return d;};
 const dialog=makeDialog('route-planning-dialog','Маршрут и подготовка'),preview=makeDialog('route-planning-preview','Предпросмотр изменений'),content=dialog.querySelector('[data-route-content]'),error=dialog.querySelector('[data-route-error]'),body=dialog.querySelector('.ui-overlay-body'),previewContent=preview.querySelector('[data-route-content]'),previewError=preview.querySelector('[data-route-error]');
 const setBusy=v=>{busy=v;onState?.({busy,dirty:dirty||stack.some(s=>s.dirty)});},setDirty=v=>{dirty=v;onState?.({busy,dirty:dirty||stack.some(s=>s.dirty)});};
 let discardAction=null;
 const canClose=(navigation='close')=>{
  if(busy)return false;
  if(!(dirty||(navigation==='close'&&stack.some(s=>s.dirty))))return true;
  discardAction=navigation;error.innerHTML='Изменения не сохранены. '+btn('discard-form','','Закрыть без сохранения')+btn('keep-form','','Продолжить редактирование');error.scrollIntoView({block:'nearest'});return false;
 };
 const inspector=makeDialog('route-planning-inspector','Связанная запись'),inspectorContent=inspector.querySelector('[data-route-content]');
 inspector.querySelector('[data-route-close]').onclick=()=>inspector.close();inspector.querySelector('[data-route-back]').textContent='К предпросмотру';inspector.querySelector('[data-route-back]').onclick=()=>inspector.close();installDialogBackdrop(inspector);
 function inspect(type,id){
  const sources=structuredClone(model.sources);
  for(const c of draft?.preview?.changes||[]){const rows=sources[c.collection],index=rows.findIndex(r=>r.id===c.id);if(index<0)rows.push(c.after);else rows[index]=c.after;}
  if(type==='constraint'){const c=byId(sources,'constraints',id);if(c){type='placement';id=c.placement_id;}}
  const card=detail({...model,sources,derived:derivePlanning(sources,model.evaluated_at)},type,id,false);
  inspector.querySelector('h2').textContent=card.title;inspectorContent.innerHTML=card.html.replace(/<section data-route-reminder><\/section>/g,'');if(!inspector.open)inspector.showModal();inspector.querySelector('.ui-overlay-body').scrollTop=0;
 }
 for(const d of [dialog,preview]){const close=()=>{if(d===preview?!busy:canClose())d.close();};d.querySelector('[data-route-close]').onclick=close;d.querySelector('[data-route-back]').onclick=()=>d===preview?close():back();installDialogBackdrop(d,{canClose:()=>d===preview?!busy:canClose()});d.addEventListener('cancel',e=>{if(d===preview?busy:!canClose())e.preventDefault();});const swipe=installSheetSwipe({card:d,document,enabled:()=>d.open&&!busy,close});d.addEventListener('close',swipe.cancel);}
 dialog.addEventListener('close',()=>{stack=[];current=null;setDirty(false);content.replaceChildren();reminder=null;if(model)history.replaceState(null,'',location.pathname+location.search);});
 const review=createTimeReview({scroller:body,content,title:dialog.querySelector('h2'),error,esc,setBusy,setDirty});
 function show(title,html,{push=true,key=null}={}){
  if(busy)return;
  if(push&&dialog.open){const fragment=document.createDocumentFragment();while(content.firstChild)fragment.append(content.firstChild);stack.push({fragment,title:dialog.querySelector('h2').textContent,current,dirty,scroll:body.scrollTop,reminder});}
  current=key;reminder=null;content.innerHTML=html;error.textContent='';dialog.querySelector('h2').textContent=title;dialog.querySelector('[data-route-back]').hidden=!stack.length;setDirty(false);if(!dialog.open)dialog.showModal();body.scrollTop=0;dialog.querySelector('h2').focus({preventScroll:true});
 }
 function back(){if(!canClose('back'))return;const old=stack.pop();if(!old){dialog.close();return;}content.replaceChildren(old.fragment);dialog.querySelector('h2').textContent=old.title;current=old.current;reminder=old.reminder;setDirty(old.dirty);body.scrollTop=old.scroll;dialog.querySelector('[data-route-back]').hidden=!stack.length;error.textContent='';}
 function showForm(title,html,submit){
  if(!allowed)return;show(title,html);const f=content.querySelector('form');f.addEventListener('input',()=>setDirty(true));f.addEventListener('change',()=>setDirty(true));
  f.onsubmit=async e=>{e.preventDefault();if(busy)return;const b=f.querySelector('[type=submit]');b.disabled=true;f.querySelector('[data-route-form-error]').textContent='';try{await submit(f);}catch(e){f.querySelector('[data-route-form-error]').textContent=e.message;}finally{b.disabled=false;}};
  const showFields=(names,visible)=>{for(const name of names){const control=f.elements[name];if(control?.closest)control.closest('label').hidden=!visible;}};
  const sync=()=>{
   const v=values(f),hasSlot=Boolean(f.elements.precision),route=!['task','decision'].includes(v.kind),duration=v.operation==='duration';
   if(hasSlot){showFields(['precision'],route&&!duration);showFields(['date_start','date_end'],route&&!duration&&['day','part_of_day','approximate'].includes(v.precision));showFields(['starts_at','ends_at'],route&&!duration&&['exact','approximate'].includes(v.precision));showFields(['start_timezone','end_timezone'],route&&!duration&&v.precision!=='unscheduled');showFields(['part_of_day'],route&&!duration&&v.precision==='part_of_day');}
   if(f.elements.operation){showFields(['duration'],duration);showFields(['reason'],v.operation==='request');}
   if(f.elements.external_url){showFields(['external_url'],v.kind==='link');showFields(['file'],v.kind==='file');}
   if(f.elements.anchor_placement_id){showFields(['anchor_placement_id','anchor','offset_unit','offset_value'],v.mode==='relative');showFields(['at','local_date'],v.mode!=='relative');}
   if(f.elements.split_date){showFields(['split_date'],v.mode==='nights');showFields(['first_units'],v.mode==='capacity');showFields(['connection_arrival','connection_departure','connection_timezone','connection_place'],v.mode==='segments');}
   if(f.elements.validity){showFields(['starts_at','ends_at'],['exact_start','exact_interval','open_window'].includes(v.validity));showFields(['date_start','date_end'],v.validity==='date_range');showFields(['hold_expires'],v.state==='held');}
  };f.addEventListener('change',sync);sync();
 }
 function open(type,id,{push=true}={}){
  if(!model||busy)return;
  if(push&&current?.type===type&&current?.id===id)return;
  if(type==='task')type='item';if(type==='place'){location.href='./#place='+encodeURIComponent(id);return;}
  // Route cards refer to the viewed placement, while readiness remains an explicit projection.
  const visible=type==='placement'?viewedModel(model,choices):model,card=detail(visible,type,id,allowed);
  show(card.title,card.html,{push,key:{type,id}});history.replaceState(null,'','#'+type+'='+encodeURIComponent(id));
  if(card.reminder)reminder=reminderCard({mount:content.querySelector('[data-route-reminder]'),item:card.reminder,plan:getZone(),notifications:notifications(),api,esc,review,setDirty,setBusy,toast,openSettings});
 }
 function render(options=display){
  if(!model)return;const old=canvas.querySelector('[data-planning-scroller]');if(old)savedScroll[display.view||'month']=old.scrollTop;
  if(display.focusDay!==options.focusDay)savedScroll.month=0;
  display=options;canvas.innerHTML=routeHtml(model,{...display,choices,prepMode,allowed});canvas.classList.add('route-canvas');
  canvas.querySelector('[data-planning-scroller]').scrollTop=savedScroll[display.view]||0;
 }
 function update(next,write){
  model=next;allowed=write;
  for(const [id,opt] of Object.entries(choices))if(!model.sources.options.some(o=>o.id===opt&&o.archived_at==null)||model.sources.decisions.find(d=>d.id===id)?.working_option_id===opt)delete choices[id];
  clearTimeout(refreshTimer);if(next.next_evaluation_at){const captured=epoch;refreshTimer=setTimeout(async()=>{if(captured!==epoch||!model)return;try{const fresh=await api('/api/planning?model=3');if(captured!==epoch)return;update(fresh,allowed);render();if(current&&!dirty&&!busy&&!preview.open)open(current.type,current.id,{push:false});}catch(e){toast(e.message);}},Math.min(2147483647,Math.max(500,next.next_evaluation_at-Date.now()+50)));}
 }
 const post=(path,value)=>api(path,{method:'POST',body:JSON.stringify(value)});
 async function stage(commands,title,after=null){
  if(!allowed||busy)return;const captured=epoch;setBusy(true);
  try{const d=await post('/api/planning/changesets',{version:3,commands});if(captured!==epoch)return;draft={...d,title,after,idempotency_key:crypto.randomUUID()};await prepare();}
  finally{setBusy(false);}
 }
 async function prepare(){
  const d=await post('/api/planning/changesets/'+draft.id+'/preview',{version:draft.version});draft={...draft,...d};drawPreview();
 }
 function drawPreview(extra=''){
  const p=draft.preview,s=structuredClone(model.sources);for(const c of p.changes){const rows=s[c.collection],i=rows.findIndex(r=>r.id===c.id);if(i<0)rows.push(c.after);else rows[i]=c.after;}
  const changes=presentChanges(p.changes,s),labels=sourceLabels(s),format=(v,key,row={})=>{if(v==null)return '—';if(key==='asset_id')return fileNames.get(v)||'Загруженный файл';if(['starts_at','ends_at','at'].includes(key)&&typeof v==='string')return when({at:v,timezone:row[key==='ends_at'?'end_timezone':'start_timezone']||row.timezone||row.event_timezone});if(typeof v==='boolean')return v?'Да':'Нет';if(key.endsWith('_json')){try{return format(JSON.parse(v),'');}catch{return String(v);}}if(Array.isArray(v))return v.map(x=>format(x,'')).join(', ')||'—';if(typeof v==='object')return Object.entries(v).filter(([k])=>k!=='schema_version').map(([k,v])=>(fieldNames[k]||k)+': '+format(v,k)).join('; ');return labels[v]||valueNames[v]||String(v);};
  preview.querySelector('h2').textContent=draft.title;preview.querySelector('[data-route-back]').hidden=true;
  previewContent.innerHTML=`${extra}<p>Проверьте результат перед сохранением. Брони у поставщиков не меняются автоматически.</p>${changes.map(c=>`<section class="route-change"><h3>${esc(c.name)} <small>${esc(collectionLabels[c.entity]||'Связь')}</small></h3><dl>${c.fields.map(k=>`<dt>${esc(fieldNames[k]||k.replaceAll('_',' '))}</dt><dd>${c.before?esc(format(c.before[k],k,c.before))+' → ':''}${esc(format(c.after?.[k],k,c.after))}</dd>`).join('')}</dl></section>`).join('')||'<p>Изменений нет.</p>'}${section('Проверки и ограничения',issuesHtml(p.issues,s))}${p.route_impact?.bookings?.length?section('Реальные брони сохраняются',p.route_impact.bookings.map(b=>`<p>${esc(labelFor(s,'service',b.service_id))}${b.lost_nights.length?' · Не используются ночи: '+esc(b.lost_nights.join(', ')):''}</p>`).join('')):''}${(p.groups||[]).filter(g=>g.nearest_start).map(g=>`<p>Ближайшее начало с учётом закрепления: ${esc(when({at:g.nearest_start,timezone:byId(model.sources,'placements',g.placement_id)?.start_timezone}))} ${btn('group-suggestion',g.placement_id,'Проверить этот перенос')}</p>`).join('')}${p.groups?.length?'<p class="muted">Групповой перенос учитывает примерный запас по прямой дистанции. Проверьте маршрут.</p>':''}${p.reminder_impact?.mine?.length||p.reminder_impact?.others_count?'<p>Будут пересчитаны связанные личные напоминания. Отправленные повторно не отправляются.</p>':''}${p.allowed_acknowledgements.map((key,i)=>`<label class="route-ack"><input type="checkbox" data-route-ack="${i}"><span>Я учитываю: ${esc(issueText(p.issues.find(i=>i.key===key)||{code:key}))}</span></label>`).join('')}<div class="route-actions"><button type="button" class="ui-button ui-button--primary" data-route-apply>Применить изменения</button>${btn('refresh-preview','','Обновить предпросмотр')}</div>`;
  previewError.textContent='';if(!preview.open)preview.showModal();preview.querySelector('.ui-overlay-body').scrollTop=0;preview.querySelector('h2').focus({preventScroll:true});
  const b=previewContent.querySelector('[data-route-apply]'),sync=()=>{b.disabled=!p.can_apply||previewContent.querySelectorAll('[data-route-ack]:checked').length!==p.allowed_acknowledgements.length;};sync();previewContent.querySelectorAll('[data-route-ack]').forEach(x=>x.onchange=sync);b.onclick=apply;
 }
 async function apply(){
  if(busy||!draft?.preview.can_apply)return;const acknowledgements=[...previewContent.querySelectorAll('[data-route-ack]:checked')].map(x=>draft.preview.allowed_acknowledgements[Number(x.dataset.routeAck)]);if(acknowledgements.length!==draft.preview.allowed_acknowledgements.length)return;
  setBusy(true);const b=previewContent.querySelector('[data-route-apply]');b.disabled=true;
  try{
   let receipt;try{receipt=await post('/api/planning/changesets/'+draft.id+'/apply',{version:draft.version,fingerprint:draft.preview.fingerprint,idempotency_key:draft.idempotency_key,acknowledgements});}catch(e){if(!e.status||e.status>=500){const status=await api('/api/planning/changesets/'+draft.id);if(status.result)receipt=status.result;else throw e;}else throw e;}
   if(!receipt?.operation_id)throw Error('Результат пока не подтверждён. Обновите предпросмотр, чтобы проверить сохранение.');
   const after=draft.after;preview.close();setDirty(false);stack=[];setBusy(false);await onRefresh();toast('Изменения сохранены.');if(after){const [type,id]=after.split(':');open(type,id,{push:false});}else if(dialog.open)dialog.close();draft=null;
  }catch(e){previewError.textContent=e.message+(e.status===409?' Ваш ввод сохранён. Обновите предпросмотр и сверьте новые данные.':'');b.disabled=true;}
  finally{setBusy(false);}
 }
 async function refreshPreview(){
  if(busy||!draft)return;setBusy(true);
  try{
   const status=await api('/api/planning/changesets/'+draft.id);if(status.result){preview.close();setDirty(false);setBusy(false);await onRefresh();dialog.close();toast('Сохранение подтверждено.');draft=null;return;}
   const fresh=await api('/api/planning?model=3'),old=model,changed=[];draft={...draft,...status};const commands=structuredClone(draft.commands);
   for(const c of commands){const target=commandVersionTarget(c,old.sources);if(!target||!c.expected_version)continue;const previous=byId(old.sources,target.collection,target.id),current=byId(fresh.sources,target.collection,target.id);if(current&&current.version!==c.expected_version){if(!changed.some(r=>r.collection===target.collection&&r.id===target.id))changed.push({...target,before:previous||{},after:current});c.expected_version=current.version;}}
   update(fresh,allowed);render();
   if(changed.length){setBusy(false);showConflict(changed,commands);return;}
   draft={...draft,...status};await prepare();
  }catch(e){previewError.textContent=e.message;}finally{setBusy(false);}
 }
 function showConflict(changed,commands){
  previewContent.innerHTML='<p class="route-issue">Эти записи изменились после открытия формы. Сверьте чужие правки. Ваш ввод сохранён в форме за этим окном.</p>'+changed.map(c=>`<section><h3>${esc(labelFor(model.sources,c.collection,c.id))}</h3><p>${esc(when(c.before))} → ${esc(when(c.after))}</p>${['title','description','note','state','label','provider_name','reference'].filter(k=>c.before[k]!==c.after[k]).map(k=>`<p>${esc(fieldNames[k]||k)}: ${esc(c.before[k]||'—')} → ${esc(c.after[k]||'—')}</p>`).join('')}</section>`).join('')+btn('rebase-preview','','Сверил: проверить мой вариант заново','primary');
  previewContent.querySelector('[data-route-action=rebase-preview]').onclick=async()=>{if(busy)return;setBusy(true);try{const d=await api('/api/planning/changesets/'+draft.id,{method:'PUT',body:JSON.stringify({version:3,expected_version:draft.version,commands})});draft={...draft,...d};await prepare();}catch(e){previewError.textContent=e.message;}finally{setBusy(false);}};
 }
 async function upload(file){
  if(file.size>20*1024*1024||!['application/pdf','image/png','image/jpeg'].includes(file.type))throw Error('Нужен PDF, PNG или JPEG размером до 20 МБ.');
  const captured=epoch;setBusy(true);try{const bytes=await file.arrayBuffer(),sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join(''),u=await post('/api/documents/uploads',{original_name:file.name,byte_size:file.size,sha256,mime:file.type});await api('/api/documents/uploads/'+u.id+'/content',{method:'POST',body:file,headers:{'Content-Type':file.type}});const result=await post('/api/documents/uploads/'+u.id+'/finalize',{});if(captured!==epoch)throw Error('Сессия изменилась.');fileNames.set(result.asset.id,file.name);return result.asset.id;}finally{setBusy(false);}
 }
 async function download(id){const metadata=await api('/api/documents/'+id),d=metadata.documents[0],captured=epoch,blob=await api('/api/documents/'+id+'/content',{responseType:'blob'});if(captured!==epoch)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=d.asset?.original_name||d.title;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const editors=createRouteEditors({showForm,stage,getModel:()=>model,getUsers,upload});
 async function action(name,id){
  if(busy||!model)return;
  if(name==='open'){const [type,value]=id.split(':');if(preview.open||inspector.open)inspect(type,value);else open(type,value);return;}
  if(name==='keep-form'){discardAction=null;error.textContent='';return;}
  if(name==='discard-form'){const action=discardAction;discardAction=null;error.textContent='';setDirty(false);if(action==='back')return back();dialog.close();return;}
  if(name==='back')return back();
  if(name==='day')return onDay(id);
  if(name==='jump-segment'){const el=canvas.querySelector('[data-decision-id="'+CSS.escape(id)+'"]');el?.scrollIntoView({block:'start',behavior:'instant'});el?.querySelector('button')?.focus({preventScroll:true});return;}
  if(name==='view-option'){const [decision,option]=id.split(':');if(!option)return;if(model.sources.decisions.find(d=>d.id===decision)?.working_option_id===option)delete choices[decision];else choices[decision]=option;render();return;}
  if(name==='reset-view'){choices={};render();return;}
  if(name==='preparation')return show('Подготовка',preparationHtml(model,{mode:prepMode,day:display.focusDay,search:display.search,state:display.state}));
  if(name==='excluded')return show('Исключённые пункты',activeRows(model.sources,'placements').filter(p=>p.participation==='excluded').map(p=>`<p>${link('placement',p.id,labelFor(model.sources,'placement',p.id))} · ${esc(when(p))}</p>`).join('')||'<p>Исключённых пунктов нет.</p>');
  if(name==='registry')return show('Билеты и брони',(allowed?btn('new-booking','','＋ Бронь'):'')+registry(model));
  if(name==='download')return download(id);
  if(name==='document-history'){const ids=new Set(model.sources.booking_documents.filter(l=>l.booking_id===id).map(l=>l.document_id));return show('История документов',model.sources.documents.filter(d=>ids.has(d.id)).map(d=>`<p>${link('document',d.id,d.title)} · ${d.archived_at?'Архив / предыдущая версия':'Текущая версия'}</p>`).join('')||'<p>Документов нет.</p>');}
  if(name==='document-events'){const d=await api('/api/documents/'+id+'/events');return show('История изменений',d.events.map(e=>`<p>${esc(new Date(e.created_at).toLocaleString('ru'))} · ${esc(getUsers().find(u=>u.id===e.actor_id)?.name||'Участник')} · ${esc(e.action)}</p>`).join('')||'<p>История пуста.</p>');}
  if(name==='refresh-preview')return refreshPreview();
  if(name==='group-suggestion'&&allowed){const group=draft?.preview.groups.find(g=>g.placement_id===id);if(!group?.nearest_start)return;const commands=structuredClone(draft.commands),c=commands.find(c=>c.type==='apply_group_shift'&&c.id===id);if(c){c.data.starts_at=group.nearest_start;return stage(commands,'Проверить предложенный перенос',draft.after);}}
  if(!allowed)return;
  return editors.handle(name,id);
 }
 const click=e=>{const b=e.target.closest('[data-route-action]');if(!b)return;e.preventDefault();void Promise.resolve(action(b.dataset.routeAction,b.dataset.id||'')).catch(e=>{if(dialog.open)error.textContent=e.message;else toast(e.message);});};
 for(const el of [canvas,content,previewContent,inspectorContent,error])el.addEventListener('click',click);
 const change=e=>{if(e.target.matches('[data-route-prep-filter]')){prepMode=e.target.value;render();if(dialog.open&&!current&&!content.querySelector('form')){content.innerHTML=preparationHtml(model,{mode:prepMode,day:display.focusDay,search:display.search,state:display.state});}}};canvas.addEventListener('change',change);content.addEventListener('change',change);
 const optionSwipe=installSwipeGesture({surface:canvas,axis:'x',pointer:true,enabled:target=>Boolean(model)&&!busy&&Boolean(target.closest('[data-route-swipe]')),canStart:e=>!e.target.closest('input,textarea,select,a'),onFinish:({dx,dy,target})=>{if(Math.abs(dx)<55||Math.abs(dx)<Math.abs(dy)*1.4)return;const el=target.closest('[data-route-swipe]'),option=dx<0?el.dataset.next:el.dataset.prev;if(option)void action('view-option',el.dataset.routeSwipe+':'+option);}});
 const dateSwipe=installSwipeGesture({surface:canvas,axis:'x',pointer:true,enabled:target=>Boolean(model)&&display.view==='month'&&!busy&&!document.querySelector('dialog[open]')&&!target.closest('[data-route-swipe]')&&Boolean(target.closest('.route-month')||window.matchMedia('(max-width:720px)').matches&&target.closest('.route-main')),canStart:e=>!e.target.closest('input,textarea,select,a'),onFinish:({dx,dy,target})=>{if(Math.abs(dx)<55||Math.abs(dx)<Math.abs(dy)*1.4)return;const direction=dx<0?1:-1;if(target.closest('.route-month'))onMonth(direction);else onDay(addDays(display.focusDay,direction));}});
 return {update,render,open,edit:()=>editors.handle('new',''),canLeave:canClose,get active(){return Boolean(model)},get blocked(){return busy||dirty||dialog.open||preview.open},refreshDevices:()=>reminder?.updateDevices(),openHash(){const p=new URLSearchParams(location.hash.slice(1));for(const type of ['item','placement','need','booking','service','decision','option','document','deadline'])if(p.has(type)){open(type,p.get(type));break;}},reset(){epoch++;optionSwipe.cancel();dateSwipe.cancel();clearTimeout(refreshTimer);model=null;choices={};draft=null;fileNames.clear();stack=[];setDirty(false);setBusy(false);preview.close();inspector.close();dialog.close();canvas.classList.remove('route-canvas');}};
}
const fieldNames={title:'Название',description:'Описание',note:'Заметка',state:'Состояние',label:'Название',kind:'Тип',priority:'Приоритет',assignee_id:'Ответственный',date_start:'Дата начала',date_end:'Дата окончания',starts_at:'Начало',ends_at:'Окончание',start_timezone:'Пояс начала',end_timezone:'Пояс окончания',precision:'Точность',part_of_day:'Часть дня',intended_duration_minutes:'Длительность, мин',order_key:'Порядок',commitment:'Утверждение времени',participation:'Участие',item_id:'Запись',placement_id:'Пункт',need_id:'Потребность',task_id:'Задача',service_id:'Услуга',booking_id:'Бронь',document_id:'Документ',option_id:'Вариант',decision_id:'Решение',working_option_id:'Рабочий вариант',accepted_option_id:'Принятый вариант',resolution:'Решение',provider_name:'Поставщик',reference:'Номер брони',category:'Категория',source_urls:'Источники',source_url:'Источник',validity:'Условия времени',capacity_units:'Количество',required_units:'Требуется единиц',allocated_units:'Используется единиц',unit_type:'Единицы',terms_json:'Условия',criteria_json:'Условия готовности',scope_id:'Участок',activation_scope_id:'Область подготовки',task_activation:'Применимость задачи',owner_scope_id:'Общий участок',owner_decision_id:'Владелец вариантов',archived_at:'Архивировано',completed_at:'Выполнено',at:'Момент',local_date:'Дата',timezone:'Часовой пояс',mode:'Способ',origin:'Источник срока',selection:'Выбор',role:'Роль места',place_id:'Место',label_snapshot:'Название места',expected_version:'Версия',relation:'Связь',required_task_id:'Блокирующая задача',required_option_id:'Необходимый вариант',other_option_id:'Другой вариант',reason:'Причина',external_url:'Ссылка',replaces_document_id:'Предыдущая версия',replaces_service_id:'Предыдущая услуга',asset_id:'Загруженный файл',hold_expires_at:'Временная бронь до',arrival_lead_minutes:'Прибыть заранее, мин',exit_allowance_minutes:'После окончания, мин',use_mode:'Использование',context_note:'Пояснение',lifecycle:'Актуальность',minimum_minutes:'Минимальный интервал',minutes:'Минуты',route_checked:'Маршрут проверен',from_placement_id:'От пункта',to_placement_id:'До пункта',action:'Действие',cancellation_policy:'Отмена',change_policy:'Изменения',notes:'Условия',min_duration_minutes:'Минимальная длительность',max_duration_minutes:'Максимальная длительность'};
const valueNames={file:'Файл',link:'Внешняя ссылка',open:'Открыто',in_progress:'В работе',done:'Выполнено',cancelled:'Отменено',confirmed:'Подтверждено',held:'Временная бронь',pending:'Ожидает подтверждения',used:'Использовано',superseded:'Заменено',tentative:'Предварительно',approved:'Утверждено',included:'Включено',excluded:'Исключено',exact:'Точное',approximate:'Примерное',day:'Дата',unscheduled:'Без даты',exact_start:'Фиксировано начало',exact_interval:'Фиксирован интервал',date_range:'Диапазон дат',open_window:'Допустимое окно',unknown:'Неизвестно',active:'Требуется',retired:'Больше не требуется',waived:'Отказались',visit:'Посещение',task:'Подготовка',stay:'Проживание',transport:'Транспорт',decision:'Решение',accepted:'Принято',normal:'Обычный',person:'Человек',room:'Номер',group:'Группа',unspecified:'Не указаны',admission:'Вход',accommodation:'Проживание',exclusive:'Одно использование',shared:'Многоразовое',chosen:'Выбрано',candidate:'Кандидат',allowed:'Разрешено',forbidden:'Запрещено'};
