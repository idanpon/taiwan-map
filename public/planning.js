import {readClientConfiguration,sessionStores,escapeHtml as esc} from './client-runtime.js';
import {createApiClient} from './api-client.js';
import {createAccountUI} from './accounts.js';
import {createAuthStartup,createLoadingScreenUI} from './auth-startup.js';
import {createThemeUI} from './theme.js';
import {createHelpUI} from './help.js';
import {installDialogBackdrop} from './dialogs.js';
import {installSheetSwipe} from './sheet-swipe.js';
import {createNotice} from './notice.js';
import {renderPlanningPilot,pilotIcon as kindIcon} from './planning-pilot-view.js';
import {dateSnapshot,moveDateDraft,planItemMove} from './planning-pilot-model.js';
import {installPlanningDrag} from './planning-drag.js';
import {renderPlanningCanvas,installPlanningLayout} from './planning-viewport.js';
import {installPlanningZoneDisclosure} from './planning-zone-disclosure.js';
import {installPlanningNavigation} from './planning-navigation.js';
import {kindLabels,stateLabels,priorityLabels,dayInZone,itemDates,urgency,dateLabel} from './planning-model.js';
import {initialZone,emptyZonePlan,localPoint,offsetLabel,zoneAt} from './trip-timezones.js';
import {createTimeReview,editTripTime,itemDateEditor,timezoneExplanation,zoneBadge,pointText} from './planning-time-ui.js';
import {reminderCard} from './planning-reminders-ui.js';
const $=id=>document.getElementById(id);
const config=window.TAIWAN_CONFIG||{};
let zone=emptyZonePlan;
let data,plan,view='month',focusDay=dayInZone(new Date(),zone),kind='',state='active',search='',busy=false,dirty=false,editingId=null,currentPreview=null,previewSequence=0,accountUI,startup,reminderUI;
const filterDisplays=[...document.querySelectorAll('.planner-filters select,.planner-filters input')].map(control=>{
 const wrapper=document.createElement('span'),value=document.createElement('span');wrapper.className='planner-filter-control';value.className='planner-filter-value';value.setAttribute('aria-hidden','true');control.before(wrapper);wrapper.append(control,value);
 const update=()=>{value.textContent=control.tagName==='SELECT'?control.selectedOptions[0]?.textContent||'':control.value||control.placeholder;value.classList.toggle('is-placeholder',control.tagName==='INPUT'&&!control.value)};
 control.addEventListener('input',update);control.addEventListener('change',update);update();return update;
});
function syncFilterDisplays(){for(const update of filterDisplays)update()}
const dialog=$('planning-dialog'),previewDialog=$('planning-preview');
const dialogBody=dialog.querySelector('.ui-overlay-body'),previewBody=previewDialog.querySelector('.ui-overlay-body');
const dialogContent=$('planning-dialog-content'),dialogError=$('planning-dialog-error'),dialogTitle=$('planning-dialog-title');
const setBusy=value=>{busy=value},setDirty=value=>{dirty=value};
const timeReview=createTimeReview({scroller:dialogBody,content:dialogContent,title:dialogTitle,error:dialogError,esc,setBusy,setDirty});
let drag,pendingId=null,lastMove=null,loadSequence=0,activeItemId=null,listLimit=180;
const viewScroll={month:0,list:0};
const layout=installPlanningLayout({canvas:$('planning-canvas'),window});
installPlanningZoneDisclosure({container:$('planning-zone-disclosure'),button:$('planning-zone-label'),popup:$('planning-zone-help'),document,window});
const notice=createNotice($('toast'));
const toast=(message,tone='neutral')=>notice.show(message,{tone});
const periodMoveMessage='Период переносится целиком. Измените даты в карточке записи.';
const {storage,legacyStorage}=sessionStores(window);
const {apiBase,configurationError,authMode}=readClientConfiguration(config);
const transport=createApiClient({apiBase,authMode,storage,legacyStorage,onUnauthorized:()=>{if(!startup?.running)showLogin()}});
async function api(path,options){if(configurationError)throw new Error(configurationError);return transport(path,options)}
const allowed=()=>data&&['admin','editor'].includes(data.user.role);
createThemeUI({document,window,onChange:()=>{}});
function canLeave(){return !busy&&(!dirty||window.confirm('Изменения не сохранены. Закрыть без сохранения?'))}
installDialogBackdrop(dialog,{canClose:canLeave});installDialogBackdrop(previewDialog,{canClose:()=>!busy});
for(const [card,canClose] of [[dialog,canLeave],[previewDialog,()=>!busy]]){
 const swipe=installSheetSwipe({card,document,enabled:()=>card.open&&card.classList.contains('ui-sheet')&&!busy,close:()=>{if(canClose())card.close()}});
 card.addEventListener('close',swipe.cancel);
}
dialog.addEventListener('cancel',e=>{if(!canLeave())e.preventDefault()});previewDialog.addEventListener('cancel',e=>{if(busy)e.preventDefault()});
dialog.addEventListener('close',()=>{
 dirty=false;editingId=null;reminderUI=null;const previous=activeItemId;activeItemId=null;if(previous)document.querySelector(`[data-record="${CSS.escape(previous)}"] [data-item]`)?.focus({preventScroll:true});
 if(plan&&new URLSearchParams(location.hash.slice(1)).has('item'))history.replaceState(null,'',location.pathname+location.search);
});
document.addEventListener('click',event=>{
 const filters=$('planning-filter-block');if(filters.open&&!filters.contains(event.target))filters.open=false;
 const badge=event.target.closest('[data-zone-toggle]'),help=badge&&$(badge.dataset.zoneToggle);
 if(!help)return;help.hidden=!help.hidden;
 for(const other of document.querySelectorAll('[data-zone-toggle]'))if(other.dataset.zoneToggle===help.id)other.setAttribute('aria-expanded',String(!help.hidden));
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('planning-filter-block').open&&!dialog.open){$('planning-filter-block').open=false;$('planning-filter-block').querySelector('summary').focus()}});
$('planning-close').onclick=()=>{if(canLeave())dialog.close()};$('planning-preview-close').onclick=()=>{if(!busy)previewDialog.close()};
function showDialog(title,html,{system=false,wide=false}={}){
 dialog.classList.toggle('ui-dialog',system);
 dialog.classList.toggle('ui-sheet',!system);
 dialog.classList.toggle('planning-form-sheet',wide);
 dialogTitle.textContent=title;dialogContent.innerHTML=html;dialogError.textContent='';dirty=false;
 if(!dialog.open)dialog.showModal();
 dialogBody.scrollTop=0;dialogTitle.focus({preventScroll:true});
}
$('login-back').onclick=()=>{location.href='./'};
function showLogin(){drag?.cancel();lastMove=null;++loadSequence;notice.clear();data=null;plan=null;dirty=false;busy=false;for(const id of ['planning-canvas','planning-dialog-content','planning-preview-content'])$(id).replaceChildren();accountUI?.update();dialog.close();previewDialog.close();$('accounts-dialog').close();$('help-dialog').close();$('application').hidden=true;$('login').hidden=false;$('auth-loading').hidden=true;$('auth-content').hidden=false;$('login-back').hidden=false;document.body.classList.remove('app-active');accountUI?.showLogin()}
function filtered(ignoreState=false){return (plan?.items||[]).filter(i=>(!kind||i.kind===kind)&&(ignoreState||!state||(state==='active'?!['done','cancelled'].includes(i.state):i.state===state))&&(!search||[i.title,i.description,i.note,...i.places.map(p=>p.place_name)].join(' ').toLowerCase().includes(search)))}
function itemMoments(i){return [i.starts_at,i.ends_at].filter(Boolean).map(at=>localPoint(at,zone))}
function itemWhen(i){
 const points=itemMoments(i);
 if(points.length)return points.map(pointText).join(' — ');
 const [start,end]=itemDates(i,zone);
 return start?dateLabel(start)+(end!==start?' — '+dateLabel(end):''):'Без даты';
}
function whenWithBadges(i,control){
 const points=itemMoments(i);
 return points.length?points.map(p=>`<span class="planning-time-point">${esc(dateLabel(p.day))} · ${esc(p.time)} ${zoneBadge(p,esc,control)}</span>`).join(' — '):esc(itemWhen(i));
}
function recordDateHtml(item){
 const points=itemMoments(item),label=points.length?points.map(point=>dateLabel(point.day)+' · '+point.time).join(' — '):itemWhen(item);
 const value=allowed()?`<button type="button" class="ui-button ui-button--quiet ui-button--compact planning-date-action" data-move-date="${esc(item.id)}" aria-label="Изменить дату: ${esc(label)}">${kindIcon('calendar')}<span>${esc(label)}</span>${kindIcon('pencil')}</button>`:`<span class="planning-date-action">${kindIcon('calendar')}<span>${esc(label)}</span></span>`;
 const badges=[...new Map(points.map(point=>[point.badge,point])).values()].map(point=>zoneBadge(point,esc,'planning-item-zone-help')).join('');
 return `<div class="planning-record-date">${value}${badges}</div>`;
}
const statesForKind=kind=>kind==='visit'?{open:'Запланировано',in_progress:'В пути / идёт',done:'Состоялось',cancelled:'Пропустили'}:kind==='decision'?{open:'Открыто',in_progress:'В работе',done:'Принято',cancelled:'Отменено'}:stateLabels;
function stateLabel(i){return statesForKind(i.kind)[i.state]}
function render(){
 syncFilterDisplays();if(!plan)return;const top=window.scrollY,items=filtered(),today=dayInZone(new Date(),zone);
 const canvas=$('planning-canvas'),previous=canvas.querySelector('[data-planning-scroller]');
 if(previous)viewScroll[previous.dataset.planningScroller]=previous.scrollTop;
 if(canvas.dataset.day!==focusDay)viewScroll.month=0;
 $('planning-trip').textContent='Вылет '+dateLabel(plan.trip.departure_date)+' · '+dateLabel(plan.trip.start_date)+' — '+dateLabel(plan.trip.end_date);
 $('planning-new').hidden=!allowed();$('planning-trip-edit').hidden=!allowed();
 for(const button of $('planning-views').querySelectorAll('[data-view]'))button.setAttribute('aria-pressed',String(button.dataset.view===view));
 $('planning-zone-label').textContent=localPoint(Date.now(),zone).badge;
 $('planning-zone-help').innerHTML=`<p>${timezoneExplanation}</p><ul><li>Москва · Europe/Moscow · UTC+3</li>${zone.changes.map(change=>`<li>С ${esc(pointText(localPoint(change.at,zone)))} · ${esc(change.zone)}</li>`).join('')}</ul>`;
 $('planning-period').textContent=view==='month'?new Intl.DateTimeFormat('ru',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(focusDay+'T12:00:00Z')):'';
 $('planning-navigation').hidden=view==='list';$('planning-list-actions').hidden=view!=='list';
 const completed=filtered(true).filter(item=>item.state==='done').length;
 $('planning-completed-control').hidden=!completed&&state==='active';$('planning-completed-label').textContent='Выполненные · '+completed;$('planning-completed').checked=state===''||state==='done';
 $('planning-canvas').dataset.view=view;canvas.dataset.day=focusDay;
 renderPlanningCanvas(canvas,renderPlanningPilot({view,items,plan,zone,focusDay,today,allowed:allowed(),pendingId,listLimit,hasFilters:Boolean(kind||search||state!=='active'||plan.items.length&&!items.length)}));
 const scroller=canvas.querySelector('[data-planning-scroller]');if(scroller)scroller.scrollTop=viewScroll[view];
 $('planning-prev').hidden=$('planning-next').hidden=view==='list';window.scrollTo(0,top);layout.refresh();
}
function placesHtml(item){return item.places.length?'<section class="planning-relations"><h3>Связанные места</h3>'+[...new Map(item.places.map(l=>[(l.place_id||l.place_name),l])).values()].map(l=>l.place_id?`<a class="planning-related-item" href="./#place=${encodeURIComponent(l.place_id)}">${esc(l.place_name)} ↗${l.hidden?'<span>Место скрыто</span>':''}</a>`:`<p>${esc(l.place_name)} <span class="muted">· Место удалено</span></p>`).join('')+'</section>':''}
function relationRows(items){return '<ul class="planning-relation-list ui-list">'+items.map(i=>`<li><button class="planning-relation-row" data-item="${esc(i.id)}"><span class="planning-relation-name">${kindIcon(i.kind)}<span>${esc(i.title)}</span></span><span class="ui-status planning-state" data-state="${esc(i.state)}">${esc(stateLabel(i))}</span></button></li>`).join('')+'</ul>'}
function relationsHtml(item){const incoming=plan.items.filter(i=>i.dependencies.includes(item.id)),deps=item.dependencies.map(id=>plan.items.find(i=>i.id===id)).filter(Boolean);return (deps.length?'<section class="planning-relations"><h3>Зависит от</h3>'+relationRows(deps)+'</section>':'')+(incoming.length?'<section class="planning-relations"><h3>Следующие шаги</h3>'+relationRows(incoming)+'</section>':'')}
function actionsHtml(item){
 if(!allowed())return '';
 const id=esc(item.id),primary=item.kind==='decision'&&item.state==='done'?`<button class="ui-button ui-button--primary" data-reopen="${id}">Пересмотреть решение</button>`:item.kind!=='decision'&&item.state!=='cancelled'?`<button class="ui-button ${item.state==='done'?'ui-button--quiet':'ui-button--success'}" data-complete="${id}">${kindIcon(item.state==='done'?'undo':'check')}${item.state==='done'?'Вернуть в план':'Готово'}</button>`:'';
 return `<div class="planning-record-actions">${primary}<div class="planning-record-secondary"><button class="ui-button ui-button--quiet ui-button--compact" data-edit="${id}">Изменить</button><button class="ui-button ui-button--quiet ui-button--compact ui-button--danger" data-delete="${id}">Удалить</button></div></div>`;
}
function openItem(id){
 if(!plan||!canLeave())return;const i=plan.items.find(i=>i.id===id);if(!i){toast('Запись удалена или недоступна.');return}editingId=null;activeItemId=id;
 const u=urgency(i,{zone}),deadlineToday=i.kind!=='visit'&&u.kind==='current'&&itemDates(i,zone)[1]===dayInZone(new Date(),zone);
 showDialog(i.title,`<div class="planning-dialog-meta muted"><span class="planning-kind-label" data-kind="${i.kind}">${kindIcon(i.kind)}${esc(kindLabels[i.kind])}</span><span aria-hidden="true">·</span><span class="ui-status" data-state="${esc(i.state)}">${esc(stateLabel(i))}</span></div>${recordDateHtml(i)}<p class="muted" id="planning-item-zone-help" hidden>${timezoneExplanation}</p>${u.label&&u.kind!=='quiet'?`<span class="planning-indicator ${u.kind} ${deadlineToday?'is-deadline':''}">${esc(deadlineToday?'Срок сегодня':u.label)}</span>`:''}${i.fixed_external?'<p class="planning-warning">Фиксированная внешняя дата / время. Перенос поездки не сдвигает её.</p>':''}${i.description?`<div class="planning-description">${esc(i.description)}</div>`:''}${i.note?`<h3>Заметка участников</h3><div class="planning-note">${esc(i.note)}</div>`:''}${placesHtml(i)}${relationsHtml(i)}${i.source_urls.length?`<details><summary>Источники</summary>${i.source_urls.map(url=>`<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)} ↗</a></p>`).join('')}</details>`:''}${i.kind==='decision'?`<h3>${i.state==='done'?'Принятое решение':'Варианты'}</h3><div class="planning-options">${i.options.map(o=>`<button type="button" class="ui-button" data-option="${esc(o.id)}" data-decision="${esc(i.id)}" ${!allowed()||!['open','in_progress'].includes(i.state)?'disabled':''}>${i.selected_option_id===o.id?'✓ ':''}${esc(o.label)}${o.description?`<span class="muted planning-description"> — ${esc(o.description)}</span>`:''}</button>`).join('')||'<p class="muted">Варианты ещё не заданы.</p>'}</div>`:''}${actionsHtml(i)}<section id="planning-reminder" class="planning-reminder"></section><details class="planning-history" id="planning-history"><summary>История изменений</summary><div>Загрузка…</div></details>`);
 history.replaceState(null,'','#item='+encodeURIComponent(id));
 reminderUI=reminderCard({mount:$('planning-reminder'),item:i,plan:zone,notifications:accountUI.notifications,api,esc,review:timeReview,setDirty,setBusy,toast,openSettings:()=>{if(!busy)void accountUI.openNotifications()}});
 $('planning-history').addEventListener('toggle',async e=>{if(!e.target.open)return;try{const result=await api('/api/planning/items/'+id+'/events');const labels={create:'Создано',update:'Изменено',resolve:'Принято решение',reopen:'Решение открыто повторно'};if($('planning-history'))$('planning-history').querySelector('div').innerHTML=result.events.map(x=>`<p>${esc(new Date(x.created_at).toLocaleString('ru',{timeZone:zoneAt(x.created_at,zone).zone}))} · ${esc(x.actor)}<br>${esc(labels[x.action]||x.action)}</p>`).join('')||'История пуста.'}catch(error){toast(error.message)}},{once:true});
}
function selectOptions(values,current){return Object.entries(values).map(([id,label])=>`<option value="${id}" ${id===current?'selected':''}>${esc(label)}</option>`).join('')}
function editItem(id=null,day=dayInZone(new Date(),zone)){
 if(!allowed()||!canLeave())return;const old=id?plan.items.find(i=>i.id===id):null;if(id&&!old)return;
 const i=old||{kind:'task',title:'',description:'',note:'',state:'open',priority:'normal',date_start:day,date_end:null,starts_at:null,ends_at:null,event_timezone:initialZone.zone,sort_order:0,fixed_external:false,source_urls:[],options:[],places:[],dependencies:[]};editingId=id;
 let options=i.options.map(o=>({...o})),links=i.places.map(l=>({...l}));
 const dates=itemDateEditor(i,zone,esc);
 showDialog(id?'Изменить запись':'Новая запись',`<form id="planning-form" class="planning-form"><div class="form-columns"><label>Тип<select class="ui-field ui-field--soft" name="kind">${selectOptions(kindLabels,i.kind)}</select></label><label>Приоритет<select class="ui-field ui-field--soft" name="priority">${selectOptions(priorityLabels,i.priority)}</select></label></div><label>Название<input class="ui-field ui-field--soft" name="title" required maxlength="160" value="${esc(i.title)}"></label><label>Описание<textarea class="ui-field ui-field--soft" name="description" maxlength="10000">${esc(i.description)}</textarea></label><label>Заметка участников<textarea class="ui-field ui-field--soft" name="note" maxlength="5000">${esc(i.note)}</textarea></label><div class="form-columns"><label>Состояние<select class="ui-field ui-field--soft" name="state">${selectOptions(statesForKind(i.kind),i.state)}</select></label><label>Ответственный<select class="ui-field ui-field--soft" name="assignee_id"><option value="">Не назначен</option>${plan.users.map(u=>`<option value="${esc(u.id)}" ${i.assignee_id===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label></div>${dates.html}<label>Порядок внутри дня<input class="ui-field ui-field--soft" name="sort_order" type="number" min="-1000000" max="1000000" value="${i.sort_order}"></label><label>Источники — по одному URL на строку<textarea class="ui-field ui-field--soft" name="source_urls" placeholder="https://…">${esc(i.source_urls.join('\n'))}</textarea></label><section id="planning-options-editor"><h3>Варианты решения</h3><div id="planning-option-rows"></div><button class="ui-button ui-button--quiet ui-button--compact" type="button" id="planning-option-add">＋ Вариант</button></section><details><summary>Связанные места</summary><div id="planning-place-rows"></div><label>Добавить место<select class="ui-field" id="planning-place-select"><option value="">Выберите место</option>${plan.places.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.city)}${p.hidden?' · скрыто':''}</option>`).join('')}</select></label><button class="ui-button ui-button--quiet ui-button--compact" type="button" id="planning-place-add">＋ Связать</button></details>${old?relationsHtml(old):''}<p class="muted">Сложные зависимости настраиваем через чат. Смена дат не пересчитывает остальные сроки.</p><div class="planning-form-actions"><button type="submit" class="ui-button ui-button--primary">Сохранить</button><button id="planning-form-cancel" type="button" class="ui-button ui-button--quiet">Отмена</button></div></form>`,{wide:true});
 const form=$('planning-form');dates.mount(form);
 function redrawRelations(){
  $('planning-options-editor').hidden=form.elements.kind.value!=='decision';
  $('planning-option-rows').innerHTML=options.map((o,n)=>`<div class="place-link-row"><label>Вариант ${n+1}<input class="ui-field ui-field--soft" data-option-label="${n}" value="${esc(o.label)}" maxlength="160" required></label><label>Пояснение<textarea class="ui-field ui-field--soft" data-option-description="${n}" maxlength="5000">${esc(o.description)}</textarea></label><button type="button" class="ui-button ui-button--quiet ui-button--compact ui-button--danger" data-option-remove="${n}">Убрать вариант</button></div>`).join('');
  for(const input of $('planning-option-rows').querySelectorAll('input,textarea'))input.disabled=form.elements.kind.value!=='decision';
  $('planning-place-rows').innerHTML=links.map((l,n)=>`<div class="place-link-row"><strong>${esc(l.place_name)}</strong>${!l.place_id?' <span class="muted">Место удалено</span>':''}<div class="linked-options">${form.elements.kind.value==='decision'?`<select class="ui-field ui-field--soft" data-link-option="${n}" aria-label="Вариант для места"><option value="">Общая связь</option>${options.map(o=>`<option value="${esc(o.id)}" ${l.option_id===o.id?'selected':''}>${esc(o.label)}</option>`).join('')}</select><label><input type="checkbox" data-link-affects="${n}" ${l.affects_visit?'checked':''}> Определяет посещение (под вопросом)</label><select class="ui-field ui-field--soft" data-link-action="${n}" aria-label="Если вариант не выбран"><option value="keep" ${l.unselected_action==='keep'?'selected':''}>Оставить альтернативу</option><option value="hide" ${l.unselected_action==='hide'?'selected':''}>Скрыть альтернативу</option></select>`:''}<button type="button" class="ui-button ui-button--quiet ui-button--compact ui-button--danger" data-link-remove="${n}">Убрать связь</button></div></div>`).join('');
 }
 redrawRelations();
 if(old?.kind==='decision'&&old.state==='done'){
  for(const control of [form.elements.kind,form.elements.state,...$('planning-options-editor').querySelectorAll('input,textarea,button'),...$('planning-place-rows').querySelectorAll('input,select,button'),$('planning-place-select'),$('planning-place-add')])control.disabled=true;
  form.insertAdjacentHTML('afterbegin','<p class="muted">Варианты меняются через «Пересмотреть решение». Описание и заметку можно сохранить здесь.</p>');
 }
 form.addEventListener('input',e=>{dirty=true;const t=e.target;if(t.hasAttribute('data-option-label'))options[Number(t.dataset.optionLabel)].label=t.value;if(t.hasAttribute('data-option-description'))options[Number(t.dataset.optionDescription)].description=t.value;if(t.hasAttribute('data-link-option'))links[Number(t.dataset.linkOption)].option_id=t.value||null;if(t.hasAttribute('data-link-affects'))links[Number(t.dataset.linkAffects)].affects_visit=t.checked;if(t.hasAttribute('data-link-action'))links[Number(t.dataset.linkAction)].unselected_action=t.value});
 form.elements.kind.onchange=()=>{dirty=true;form.elements.state.innerHTML=selectOptions(statesForKind(form.elements.kind.value),form.elements.state.value);redrawRelations()};
 $('planning-option-add').onclick=()=>{options.push({id:crypto.randomUUID(),label:'',description:''});dirty=true;redrawRelations()};
 $('planning-place-add').onclick=()=>{const p=plan.places.find(p=>p.id===$('planning-place-select').value);if(!p)return;links.push({place_id:p.id,place_name:p.name,option_id:null,affects_visit:false,unselected_action:'keep'});dirty=true;redrawRelations()};
 form.addEventListener('click',e=>{const o=e.target.closest('[data-option-remove]'),l=e.target.closest('[data-link-remove]');if(o){const removed=options.splice(Number(o.dataset.optionRemove),1)[0];links=links.map(l=>l.option_id===removed.id?{...l,option_id:null,affects_visit:false}:l);dirty=true;redrawRelations()}if(l){links.splice(Number(l.dataset.linkRemove),1);dirty=true;redrawRelations()}});
 $('planning-form-cancel').onclick=()=>{if(canLeave()){dirty=false;if(old)openItem(old.id);else dialog.close()}};
 form.onsubmit=async e=>{
  e.preventDefault();if(busy)return;const values=new FormData(form),nextKind=values.get('kind')||i.kind;
  let payload;try{payload={kind:nextKind,title:values.get('title'),description:values.get('description'),note:values.get('note'),state:values.get('state')||i.state,priority:values.get('priority'),assignee_id:values.get('assignee_id')||null,...dates.values(form),sort_order:Number(values.get('sort_order')),fixed_external:form.elements.fixed_external.checked,source_urls:String(values.get('source_urls')).split('\n').map(s=>s.trim()).filter(Boolean),options:nextKind==='decision'?options:[],places:nextKind==='decision'?links:links.map(l=>({...l,option_id:null,affects_visit:false})),dependencies:i.dependencies,...(id?{version:i.version}:{})}}catch(error){$('planning-dialog-error').textContent=error.message;return}
  busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{const result=await saveItem(id,payload);dirty=false;editingId=null;await load();busy=false;openItem(result.item.id)}catch(error){$('planning-dialog-error').textContent=error.message;if(error.status===409)toast('Черновик сохранён в открытой форме. Скопируйте важный текст перед обновлением.')}finally{busy=false;form.querySelectorAll('button').forEach(b=>b.disabled=false)}
 };
}
async function saveItem(id,payload){const path='/api/planning/items'+(id?'/'+id:'');try{return await api(path,{method:id?'PUT':'POST',body:JSON.stringify(payload)})}catch(error){if(error.details?.code==='dependencies_open'&&window.confirm(error.message+'\n\n'+error.details.dependencies.map(i=>i.title).join('\n')))return api(path,{method:id?'PUT':'POST',body:JSON.stringify({...payload,ack_dependencies:true})});throw error}}
function applySavedItem(item){plan.items=plan.items.map(old=>old.id===item.id?item:old)}
async function completeItem(id,{quick=false}={}){
 if(!allowed()||busy)return;const item=plan.items.find(item=>item.id===id);if(!item||item.kind==='decision'||item.state==='cancelled')return;
 busy=true;pendingId=id;++loadSequence;render();
 try{
  const next=item.state==='done'?'open':'done',result=await saveItem(id,{version:item.version,state:next});applySavedItem(result.item);render();
  toast(next==='done'?'«'+item.title+'» — готово':'«'+item.title+'» возвращено в план',next==='done'?'success':'neutral');
  if(next==='done'&&item.kind==='visit'&&item.places.some(link=>link.place_id)&&window.confirm('Посещение отмечено. Обновить статус связанных мест на «Уже посетили»?')){
   const fresh=await api('/api/data');if(!fresh.statuses.some(status=>status.id==='visited')){toast('Статус посещения недоступен. Пункт маршрута сохранён.')}else for(const placeId of new Set(item.places.map(link=>link.place_id).filter(Boolean))){const place=fresh.places.find(place=>place.id===placeId);if(place&&place.status_id!=='visited')await api('/api/places/'+place.id+'/state',{method:'PUT',body:JSON.stringify({version:place.version,status_id:'visited',note:place.note})})}
  }
  busy=false;if(!quick)openItem(id);
 }catch(error){toast(error.message);if(error.status===409)await load().catch(()=>{})}
 finally{busy=false;pendingId=null;render()}
}
async function persistMove(item,patch,{close=false}={}){
 busy=true;pendingId=item.id;++loadSequence;render();const previousFocus=focusDay;
 try{
  const result=await saveItem(item.id,{...patch,version:item.version,timezone_revision:zone.revision});
  lastMove={id:item.id,title:item.title,before:dateSnapshot(item),version:result.item.version,previousFocus};applySavedItem(result.item);
  const [day]=itemDates(result.item,zone);if(day)focusDay=day;
  if(close){dirty=false;dialog.close()}
  showMoveNotice('«'+item.title+'» → '+(day?dateLabel(day):'без даты'));
 }finally{busy=false;pendingId=null;render()}
}
function editMove(id,target=null,anchor=null,reason=''){
 if(!allowed()||!canLeave())return;const item=plan.items.find(item=>item.id===id);if(!item)return;
 activeItemId=id;const dates=itemDateEditor(item,zone,esc);
 showDialog('Изменить дату',`<form id="planning-move-form" class="planning-form"><h3>${esc(item.title)}</h3><p class="muted">Сейчас: ${whenWithBadges(item,'planning-form-zone-help')}</p>${reason?`<p class="planning-warning">${esc(reason)}</p>`:''}${dates.html}<p class="muted">Заметки, связи и состояние сохранятся. Период переносится целиком.</p><div class="planning-form-actions"><button type="submit" class="ui-button ui-button--primary">Перенести</button><button type="button" class="ui-button ui-button--quiet" data-move-back>Назад</button></div></form>`);
 const form=$('planning-move-form');dates.mount(form);
 if(target){const draft=moveDateDraft(item,target,zone,anchor);form.elements.date_mode.value=draft.end?'period':'day';form.elements.date_start.value=draft.start;form.elements.date_end.value=draft.end||'';form.elements.date_start.dispatchEvent(new Event('input',{bubbles:true}))}
 form.addEventListener('input',()=>{dirty=true});form.querySelector('[data-move-back]').onclick=()=>{if(canLeave()){dirty=false;openItem(id)}};
 form.onsubmit=async event=>{event.preventDefault();if(busy)return;let patch;try{patch={...dates.values(form),fixed_external:form.elements.fixed_external.checked}}catch(error){dialogError.textContent=error.message;return}
  form.querySelectorAll('button').forEach(button=>button.disabled=true);
  try{await persistMove(item,patch,{close:true})}catch(error){dialogError.textContent=error.message}finally{form.querySelectorAll('button').forEach(button=>button.disabled=false)}
 };
}
async function moveItem(id,target,anchor){
 if(!allowed()||busy)return;const item=plan.items.find(item=>item.id===id);if(!item)return;
 const [start,end]=itemDates(item,zone);if(start&&start!==end){toast(periodMoveMessage);return}
 const move=planItemMove(item,target,zone,anchor);if(move.unchanged)return;
 if(move.review){editMove(id,target,anchor,move.review);return}
 try{await persistMove(item,move.patch)}catch(error){toast(error.message);if(error.status===409)await load().catch(()=>{})}
}
function showMoveNotice(message){notice.show(message,{action:{label:'Отменить',run:undoMove}})}
async function undoMove(){
 if(!lastMove||!allowed()||busy)return;
 const undo=lastMove;busy=true;pendingId=undo.id;++loadSequence;render();notice.setActionBusy(true);
 try{const result=await saveItem(undo.id,{...undo.before,version:undo.version,timezone_revision:zone.revision});applySavedItem(result.item);focusDay=undo.previousFocus;lastMove=null;toast('Перенос отменён.')}
 catch(error){
  if(error.status===409){lastMove=null;toast('Запись уже изменена. Отмена не применена, чтобы сохранить новую правку.');await load().catch(()=>{})}
  else if(lastMove===undo)showMoveNotice(error.message);
 }
 finally{busy=false;pendingId=null;notice.setActionBusy(false);render()}
}
async function deleteItem(id){const i=plan.items.find(i=>i.id===id);if(!allowed()||busy||!window.confirm('Удалить запись «'+i.title+'»? Связанные места останутся.'))return;busy=true;try{await api('/api/planning/items/'+id,{method:'DELETE',body:JSON.stringify({version:i.version})});dirty=false;dialog.close();history.replaceState(null,'',location.pathname);await load();toast('Запись удалена.')}catch(error){toast(error.message)}finally{busy=false}}
async function previewDecision(id,optionId=null,mode='resolve',alternatives={}){
 if(!allowed()||busy)return;const sequence=++previewSequence;$('planning-confirm').disabled=true;$('planning-preview-error').textContent='';
 try{const p=await api('/api/planning/items/'+id+'/preview',{method:'POST',body:JSON.stringify({mode,option_id:optionId,alternatives})});if(sequence!==previewSequence)return;currentPreview=p;const item=plan.items.find(i=>i.id===id);
 $('planning-preview-content').innerHTML=`<p>${esc(item.title)}${mode==='resolve'?' → '+esc(item.options.find(o=>o.id===optionId)?.label||''):' · открыть повторно'}</p>${p.next_steps?.length?`<section><h3>Следующие шаги</h3>${p.next_steps.map(i=>`<p><button type="button" class="ui-button ui-button--quiet ui-button--compact" data-related-preview="${esc(i.id)}">${esc(i.title)}</button> · ${esc(stateLabel(i))}</p>`).join('')}</section>`:''}${p.warnings.map(w=>`<p class="planning-warning">${esc(w)}</p>`).join('')}${p.effects.map(e=>{const statusName=id=>data.statuses.find(s=>s.id===id)?.label||'Без статуса';const own=item.places.filter(l=>l.place_id===e.id&&l.affects_visit),losing=mode==='resolve'&&own.length&&!own.some(l=>l.option_id===optionId);return `<section class="planning-preview-place"><strong>${esc(e.name)}</strong><p>Статус: ${esc(statusName(e.before.status_id))}${e.before.status_id!==e.after.status_id?' → '+esc(statusName(e.after.status_id)):' · без изменений'}<br>Видимость: ${e.after.hidden?'скрыто':'на карте'}${e.before.hidden===e.after.hidden?' · без изменений':''}</p>${losing?`<label>Альтернатива<select class="ui-field ui-field--soft" data-alternative="${esc(e.id)}"><option value="keep" ${(alternatives[e.id]||own[0].unselected_action)==='keep'?'selected':''}>Оставить</option><option value="hide" ${(alternatives[e.id]||own[0].unselected_action)==='hide'?'selected':''}>Скрыть</option></select></label>`:''}${(p.related.find(r=>r.place_id===e.id)?.items||[]).filter(r=>r.id!==id).map(r=>`<p class="muted">${esc(kindLabels[r.kind])}: <button type="button" class="ui-button ui-button--quiet ui-button--compact" data-related-preview="${esc(r.id)}">${esc(r.title)}</button> · ${esc(stateLabel(r))}</p>`).join('')}</section>`}).join('')||'<p>Изменений мест нет.</p>'}`;
 $('planning-confirm').disabled=false;$('planning-confirm').textContent=mode==='resolve'?'Подтвердить выбор':'Открыть решение повторно';if(!previewDialog.open){previewDialog.showModal();previewBody.scrollTop=0}$('planning-preview-title').focus({preventScroll:true});
 for(const select of $('planning-preview-content').querySelectorAll('[data-alternative]'))select.onchange=()=>previewDecision(id,optionId,mode,{...currentPreview.alternatives,[select.dataset.alternative]:select.value});
 }catch(error){if(previewDialog.open)$('planning-preview-error').textContent=error.message;else toast(error.message)}
}
$('planning-confirm').onclick=async()=>{if(!currentPreview||busy)return;busy=true;$('planning-confirm').disabled=true;const p=currentPreview;try{await api('/api/planning/items/'+p.item_id+'/resolve',{method:'POST',body:JSON.stringify(p)});previewDialog.close();dirty=false;await load();busy=false;openItem(p.item_id);toast('Решение сохранено.')}catch(error){$('planning-preview-error').textContent=error.message;if(error.status===409){busy=false;await previewDecision(p.item_id,p.option_id,p.mode,p.alternatives)}}finally{busy=false;$('planning-confirm').disabled=false}};
function editTrip(){if(!allowed()||!canLeave())return;editTripTime({trip:plan.trip,plan:zone,esc,showDialog,dialog,setBusy,setDirty,error:dialogError,api,load,review:timeReview,toast})}
async function load({signal}={}){
 const sequence=++loadSequence;const [mapData,calendar]=await Promise.all([api('/api/data',{signal}),api('/api/planning',{signal})]);
 if(sequence!==loadSequence||drag?.active)return;const first=!plan;data=mapData;plan=calendar;zone=calendar.timezone_plan||emptyZonePlan;
 if(first)focusDay=dayInZone(new Date(),zone);
 accountUI?.update();accountUI?.hideLogin();
 $('application').hidden=false;$('login').hidden=true;document.body.classList.add('app-active');render();
 void accountUI?.notifications.refresh();
}
drag=installPlanningDrag({surface:$('planning-canvas'),document,window,enabled:()=>Boolean(allowed())&&!busy&&!document.querySelector('dialog[open]'),onDrop:moveItem,onBlocked:()=>toast(periodMoveMessage),onError:error=>toast(error.message)});
$('planning-canvas').onclick=event=>{
 const quick=event.target.closest('[data-quick-complete]');if(quick){void completeItem(quick.dataset.quickComplete,{quick:true});return}
 const item=event.target.closest('[data-item]'),record=event.target.closest('[data-record]');if(item||record){openItem(item?.dataset.item||record.dataset.record);return}
 const day=event.target.closest('button[data-day]'),calendarDay=event.target.closest('[data-calendar-day]'),add=event.target.closest('[data-new-day]');
 if(day||calendarDay){
  focusDay=(day||calendarDay).dataset[day?'day':'calendarDay'];view='month';render();
  if(calendarDay){
   $('planning-navigation').scrollIntoView({block:'start',behavior:'instant'});
   if(event.detail===0)$('planning-canvas').querySelector('[data-day][aria-pressed=true]')?.focus({preventScroll:true});
  }
 }
 else if(add)editItem(null,add.dataset.newDay);
 else if(event.target.closest('[data-more-days]')){listLimit+=180;render()}
 else if(event.target.closest('[data-clear-filters]'))resetFilters();
};
$('planning-dialog-content').addEventListener('click',e=>{const item=e.target.closest('[data-item]'),edit=e.target.closest('[data-edit]'),complete=e.target.closest('[data-complete]'),move=e.target.closest('[data-move-date]'),remove=e.target.closest('[data-delete]'),option=e.target.closest('[data-option]'),reopen=e.target.closest('[data-reopen]');if(item)openItem(item.dataset.item);if(edit)editItem(edit.dataset.edit);if(complete)void completeItem(complete.dataset.complete);if(move)editMove(move.dataset.moveDate);if(remove)void deleteItem(remove.dataset.delete);if(option)void previewDecision(option.dataset.decision,option.dataset.option);if(reopen)void previewDecision(reopen.dataset.reopen,null,'reopen')});
$('planning-preview-content').addEventListener('click',e=>{const b=e.target.closest('[data-related-preview]');if(b&&!busy){previewDialog.close();openItem(b.dataset.relatedPreview)}});
$('planning-new').onclick=()=>editItem();$('planning-trip-edit').onclick=editTrip;
$('planning-views').onclick=event=>{const button=event.target.closest('[data-view]');if(button&&button.dataset.view!==view){drag.cancel();view=button.dataset.view;render()}};
function navigate(direction){if(view!=='month')return;drag.cancel();const date=new Date(focusDay.slice(0,7)+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+direction);focusDay=date.toISOString().slice(0,10);render()}
installPlanningNavigation({canvas:$('planning-canvas'),document,navigate,enabled:()=>Boolean(plan)&&view==='month'&&!busy&&!drag.active&&!document.querySelector('dialog[open]')&&!$('application').hidden});
$('planning-prev').onclick=()=>navigate(-1);$('planning-next').onclick=()=>navigate(1);
$('planning-today').onclick=()=>{focusDay=dayInZone(new Date(),zone);render();if(view==='list'){const days=[...document.querySelectorAll('.planning-day-group[data-drop-day]:not(.planning-empty-day)')];const target=days.find(day=>day.dataset.dropDay>=focusDay)||days.at(-1)||$('planning-canvas');target.scrollIntoView({block:'start'})}};
$('planning-list-today').onclick=$('planning-today').onclick;
$('planning-completed').onchange=()=>{state=$('planning-completed').checked?'':'active';$('planning-state').value=state;render()};
$('planning-kind').onchange=e=>{kind=e.target.value;render()};$('planning-state').onchange=e=>{state=e.target.value;render()};$('planning-search').oninput=e=>{search=e.target.value.toLowerCase().trim();render()};
function resetFilters(){kind='';state='active';search='';$('planning-kind').value='';$('planning-state').value='active';$('planning-search').value='';render()}
$('planning-reset').onclick=resetFilters;
$('planning-refresh').onclick=async()=>{if(!canLeave())return;try{await load();toast('План обновлён.')}catch(error){toast(error.message)}};
$('planning-export').onclick=async()=>{try{const content=await api('/api/export'),url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='taiwan-map-and-plan.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(error){toast(error.message)}};
$('logout').onclick=async()=>{if(!canLeave())return;try{await api('/api/logout',{method:'POST'});await accountUI.notifications.signOut();showLogin()}catch(error){toast(error.message)}};
$('login-form').onsubmit=async e=>{e.preventDefault();const button=e.currentTarget.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;try{await api('/api/login',{method:'POST',body:JSON.stringify({username:$('username').value,password:$('password').value})});accountUI.resetLoginPassword();await load();openHash()}catch(error){$('login-error').textContent=error.message}finally{button.disabled=false}};
const help=createHelpUI({$,getData:()=>data,esc});$('help-open').onclick=()=>help.open();
accountUI=createAccountUI({api,$,esc,load:async()=>{await load();openHash()},toast,showLogin,getData:()=>data,canOpen:canLeave,onNotificationsChange:()=>reminderUI?.updateDevices()});
accountUI.notifications.calendar($('planning-push-invite'));
function openHash(){const id=new URLSearchParams(location.hash.slice(1)).get('item');if(id&&plan)openItem(id)}
window.addEventListener('hashchange',openHash);window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
document.addEventListener('visibilitychange',async()=>{if(document.hidden||!plan||dirty||busy||drag.active||dialog.open||previewDialog.open)return;try{await load()}catch(error){toast(error.message)}});
setInterval(()=>{if(plan&&!document.hidden&&!busy&&!dirty&&!drag.active&&!dialog.open)render()},60000);
const loadingScreen=createLoadingScreenUI({$,message:'Загружаем план поездки…'});
startup=createAuthStartup({initialize:signal=>accountUI.init(signal),load:async signal=>{await load({signal});openHash()},onLoading:()=>loadingScreen.show(),onLogin:showLogin,onError:message=>loadingScreen.error(message)});
$('auth-retry').onclick=()=>startup.run();void startup.run();
