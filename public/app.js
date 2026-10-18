import {createApiClient} from './api-client.js';
import {createAccountUI} from './accounts.js';
import {cityOptions,statusAppearance,hoursVerification,hoursOverview} from './map-model.js';
import {createStatusUI} from './statuses.js';
import {categoryIcon as icon} from './categories.js';
import {createHelpUI} from './help.js';
import {createThemeUI} from './theme.js';
import {createMapView} from './map-view.js';
import {createAuthStartup} from './auth-startup.js';
import {createPlaceLifecycleUI} from './place-lifecycle.js';
const $=id=>document.getElementById(id);
const config=window.TAIWAN_CONFIG||{apiBase:'',requiresApi:false};
let apiBase='',configurationError='';
try {
 if(config.apiBase){const url=new URL(config.apiBase);const normalized=url.origin+url.pathname.replace(/\/$/,'');if(url.protocol!=='https:'||normalized!==config.apiBase||url.search||url.hash||url.username||url.password||!/^[a-zA-Z0-9/_-]*$/.test(url.pathname))throw new Error();apiBase=normalized}
 else if(config.requiresApi)configurationError='Сервер данных ещё не подключён. Адрес API будет добавлен после настройки VPS.';
}catch{configurationError='В настройках сайта указан некорректный HTTPS-адрес API.'}

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data,map,selected=null,city='',types=new Set(),status='',query='',dirty=false,busy=false;
const themeUI=createThemeUI({document,window,onChange:value=>{map?.setTheme(value);if(data)render()}});
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5500)}
let sessionStorageForApp;try{sessionStorageForApp=window.sessionStorage}catch{}
const transport=createApiClient({apiBase,authMode:config.authMode||'cookie',storage:sessionStorageForApp,onUnauthorized:()=>{if(!startup?.running)showLogin()}});
async function api(path,options={}){if(configurationError)throw new Error(configurationError);return transport(path,options)}
async function exportData(event){event.preventDefault();try{const content=await api('/api/export');const blob=new Blob([JSON.stringify(content,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='taiwan-map.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){toast(e.message)}}
let accountUI,placeUI,startup;
function showLogin(){$('auth-loading').hidden=true;$('auth-content').hidden=false;placeUI?.close();$('help-dialog').close();$('status-dialog').close();$('accounts-dialog').close();accountUI?.showLogin();$('application').hidden=true;$('application').classList.remove('detail-open');document.body.classList.remove('app-active');setSidebar(false);$('detail').hidden=true;$('login').hidden=false;data=null;selected=null;dirty=false;if(map){map.dispose();map=null}}
function setSidebar(open){$('places-panel').classList.toggle('mobile-open',open);$('mobile-toggle').textContent=open?'Назад к карте':'Места и фильтры';$('mobile-toggle').setAttribute('aria-expanded',String(open))}
function closeDetail(restoreFocus=false){
 if($('detail').hidden)return true;
 if(busy){toast('Дождитесь завершения сохранения.');return false}
 if(dirty&&!window.confirm('Изменения не сохранены. Закрыть карточку без сохранения?'))return false;
 const id=selected;selected=null;dirty=false;$('detail').hidden=true;$('application').classList.remove('detail-open');render();
 if(restoreFocus){const card=Array.from(document.querySelectorAll('[data-place]')).find(el=>el.dataset.place===id);const target=matchMedia('(max-width:1000px)').matches?$('fit'):card||$('fit');target.focus({preventScroll:true})}
 return true;
}
function getCategory(p){return data.categories.find(c=>c.id===p.category_id)}
function getStatus(p){const value=data.statuses.find(s=>s.id===p.status_id);return value?statusAppearance(value,themeUI.value):undefined}
function visible(){return data.places.filter(p=>(!city||p.city===city)&&(!types.size||types.has(p.category_id))&&(!status||(status==='none'?!p.status_id:p.status_id===status))&&(!query||`${p.name} ${p.local_name} ${p.summary} ${p.address}`.toLowerCase().includes(query)))}
function populateFilters(){
 const cities=cityOptions(data.places);if(city&&!cities.some(c=>c.name===city))city='';
 $('city-filter').innerHTML=`<option value="">Все места · ${data.places.length}</option>`+cities.map(c=>`<option value="${esc(c.name)}">${esc(c.name)} · ${c.count}</option>`).join('');$('city-filter').value=city;
 $('category-filters').innerHTML=data.categories.map(c=>`<button class="chip ${types.has(c.id)?'active':''}" data-category="${esc(c.id)}" aria-pressed="${types.has(c.id)}">${icon(c.icon)}${esc(c.label)}</button>`).join('');
 const previous=$('status-filter').value;$('status-filter').innerHTML='<option value="">Все статусы</option><option value="none">Без статуса</option>'+data.statuses.map(s=>`<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('');$('status-filter').value=previous;
}
function render(){if(!data)return;const ps=visible();$('place-count').textContent=`${ps.length} из ${data.places.length} мест`;$('map-label').textContent=`${city||'Тайвань'} · ${ps.length} мест`;
 $('place-list').innerHTML=ps.length?ps.map(p=>{const c=getCategory(p),s=getStatus(p);return `<button class="place-card ${selected===p.id?'selected':''}" data-place="${esc(p.id)}" style="--category:${c.color};--category-bg:${c.color}14;--status:${s?.color||'#697568'};--status-opacity:${s?.opacity??1};--status-symbol:${s?.symbolColor||'#ffffff'};--status-text:${s?.textColor||'var(--muted)'}"><span class="place-icon">${icon(c.icon)}</span><span class="place-card-content"><span class="place-name">${esc(p.name)}</span><span class="place-meta">${esc(p.city)} <span>·</span> ${esc(c.label)}</span><span class="card-status"><i class="status-dot" aria-hidden="true">${esc(s?.symbol||'')}</i> ${esc(s?.label||'Без статуса')}</span></span></button>`}).join(''):'<p class="empty">Под эти фильтры пока нет мест.<br>Попробуйте другой статус или сбросьте фильтры.</p>';
 if(selected&&!ps.some(p=>p.id===selected)){selected=null;$('detail').hidden=true;$('application').classList.remove('detail-open');dirty=false}renderMarkers(ps);
}
function renderMarkers(ps=visible()){
 map?.setPlaces(ps.map(p=>({...p,category:getCategory(p),status:getStatus(p)})),selected);
}
function initMap(){
 map=createMapView({container:$('map'),statusElement:$('map-status'),statusText:$('map-status-text'),retryButton:$('map-retry'),listButton:$('map-list'),zoomIn:$('map-zoom-in'),zoomOut:$('map-zoom-out'),theme:themeUI.value,onSelect:openPlace});
}
function fit(){map?.fit()}
function detail(p){const c=getCategory(p),s=getStatus(p);$('detail').style.setProperty('--category',c.color);
 $('detail').innerHTML=`<div class="detail-header"><p class="eyebrow">${esc(p.city)} / ${esc(c.label)}</p><button type="button" class="detail-close" id="detail-close" aria-label="Закрыть карточку">×</button></div><div class="detail-body"><h2>${esc(p.name)}</h2><p class="local-name">${esc(p.local_name)}</p><p class="detail-summary">${esc(p.summary)}</p><div class="detail-info"><strong>Часы · Тайвань (UTC+8)</strong><p>${esc(p.hours.label)}</p>${p.hours.note?`<p class="hours-note">${esc(p.hours.note)}</p>`:''}<strong>Адрес</strong><p>${esc(p.address)}</p></div><p class="tip">${esc(p.tip)}</p><a class="google-link" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name+' '+p.address)}">Открыть в Google Maps ↗</a><div class="detail-links">${p.links.filter(l=>/^https:\/\//.test(l.url)).map(l=>`<a target="_blank" rel="noopener noreferrer" href="${esc(l.url)}">${esc(l.label)} ↗</a>`).join('')}</div><form id="state-form"><label for="place-status">Наш статус</label><select id="place-status"><option value="">Без статуса</option>${data.statuses.map(s=>`<option value="${esc(s.id)}" ${s.id===p.status_id?'selected':''}>${esc(s.label)}</option>`).join('')}</select><label for="place-note">Заметка к месту</label><textarea id="place-note" maxlength="2000" placeholder="Что попробовать или не забыть">${esc(p.note)}</textarea><button type="submit" id="save-state" class="primary">Сохранить</button></form><p class="verification">${esc(hoursVerification(p.verified_at))}</p>${data.user.role!=='viewer'?'<div class="place-actions"><button type="button" class="text-button" data-place-action="hide">Скрыть место</button><button type="button" class="text-button" data-place-action="delete">Удалить</button></div>':''}</div>`;
 if(data.user.role==='viewer'){const form=$('state-form');form.insertAdjacentHTML('afterbegin','<p class="muted">Доступ только для просмотра</p>');form.querySelectorAll('select,textarea').forEach(el=>el.disabled=true);$('save-state').hidden=true;}
 for(const button of $('detail').querySelectorAll('[data-place-action]'))button.onclick=()=>button.dataset.placeAction==='hide'?placeUI.hide(p):placeUI.remove(p);
 $('detail').hidden=false;$('application').classList.add('detail-open');$('detail-close').onclick=()=>closeDetail(true);$('state-form').oninput=()=>dirty=true;$('state-form').onsubmit=event=>saveState(event,p);dirty=false;
}
function openPlace(id){if(busy)return;if(dirty){if(id!==selected)toast('Сначала сохраните изменения в открытой карточке.');return}const p=data.places.find(p=>p.id===id);if(!p)return;selected=id;detail(p);render();setSidebar(false);if(map){const rect=$('detail').getBoundingClientRect();const offset=matchMedia('(max-width:1000px)').matches?[0,($('map').getBoundingClientRect().bottom-rect.top)/2]:[(rect.width+20)/2,0];map.focusPlace(p,offset)}$('detail-close').focus({preventScroll:true})}
async function saveState(event,p){event.preventDefault();if(data.user.role==='viewer')return;if(busy)return;busy=true;const note=$('place-note').value,statusId=$('place-status').value||null;$('save-state').disabled=true;try{const result=await api(`/api/places/${encodeURIComponent(p.id)}/state`,{method:'PUT',body:JSON.stringify({version:p.version,note,status_id:statusId})});Object.assign(p,{note,status_id:statusId,...result});dirty=false;render();toast('Изменения сохранены.')}catch(e){toast(e.message);if(e.status===409){try{data=await api('/api/data');const current=data.places.find(x=>x.id===p.id);populateFilters();render();if(current){detail(current);$('place-note').value=note;if(data.statuses.some(s=>s.id===statusId))$('place-status').value=statusId;dirty=true;toast('Данные обновлены. Ваш текст оставлен в поле: проверьте и сохраните ещё раз.')}}catch(err){toast(err.message)}}}finally{busy=false;if($('save-state'))$('save-state').disabled=false}}
async function load({signal}={}){data=await api('/api/data',{signal});accountUI?.update();$('login').hidden=true;$('application').hidden=false;document.body.classList.add('app-active');populateFilters();$('verified').textContent=hoursOverview(data.places);if(!map){setSidebar(false);initMap()}render();if(map)setTimeout(()=>map.resize(),0)}
$('login-form').onsubmit=async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button[type=submit]');button.disabled=true;$('login-error').textContent='';try{await api('/api/login',{method:'POST',body:JSON.stringify({username:$('username').value,password:$('password').value})});accountUI.resetLoginPassword();await load()}catch(err){$('login-error').textContent=err.message}finally{button.disabled=false}};
$('logout').onclick=async()=>{if(dirty){toast('Сначала сохраните изменения.');return}try{await api('/api/logout',{method:'POST'});showLogin()}catch(e){toast(e.message)}};
$('city-filter').onchange=e=>{if(dirty){e.target.value=city;toast('Сначала сохраните изменения.');return}city=e.target.value;render();fit()};
$('category-filters').onclick=e=>{const b=e.target.closest('[data-category]');if(!b)return;if(dirty){toast('Сначала сохраните изменения.');return}const id=b.dataset.category;types.has(id)?types.delete(id):types.add(id);populateFilters();render()};
$('status-filter').onchange=e=>{if(dirty){e.target.value=status;toast('Сначала сохраните изменения.');return}status=e.target.value;render()};
$('search').oninput=e=>{if(dirty){toast('Сначала сохраните изменения.');e.target.value=query;return}query=e.target.value.trim().toLowerCase();render()};
$('reset').onclick=()=>{if(dirty){toast('Сначала сохраните изменения.');return}city='';types.clear();status='';query='';$('search').value='';$('status-filter').value='';populateFilters();render();fit()};
$('place-list').onclick=e=>{const b=e.target.closest('[data-place]');if(b)openPlace(b.dataset.place)};$('fit').onclick=fit;
$('locate').onclick=()=>{if(!map?.available){toast('Карта недоступна. Места и ссылки доступны в списке.');return}if(!window.isSecureContext||!navigator.geolocation){toast('Геопозиции нужен HTTPS и поддержка браузера.');return}const button=$('locate');button.disabled=true;navigator.geolocation.getCurrentPosition(p=>{button.disabled=false;map?.showPosition(p.coords);toast('Ваше положение показано на карте.');},e=>{button.disabled=false;toast(e.code===1?'Доступ к геопозиции запрещён. Разрешите его в настройках браузера.':'Не удалось определить положение. Попробуйте у окна или на улице.')},{enableHighAccuracy:true,timeout:15000,maximumAge:60000})};
$('map-list').onclick=()=>{setSidebar(true);$('search').focus()};
const statusUI=createStatusUI({api,$,esc,getData:()=>data,toast,onChange:()=>{
 populateFilters();render();
 const select=$('place-status');if(select){const value=select.value;select.innerHTML='<option value="">Без статуса</option>'+data.statuses.map(s=>`<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('');select.value=value;}
}});
$('manage-statuses').onclick=()=>statusUI.open();
const helpUI=createHelpUI({$,getData:()=>data,esc});$('help-open').onclick=()=>helpUI.open();
$('mobile-toggle').onclick=()=>{if(!closeDetail())return;setSidebar(!$('places-panel').classList.contains('mobile-open'));if(map)setTimeout(()=>map.resize(),0)};
document.addEventListener('click',event=>{if($('detail').hidden||$('status-dialog').open||$('accounts-dialog').open||$('help-dialog').open||$('hidden-places-dialog').open||event.target.closest('#detail, #status-dialog, #help-dialog, #help-open, #manage-statuses, #hidden-places-open, [data-place], .maplibregl-marker, .maplibregl-ctrl, .map-tools, .map-zoom, #map-status, .theme-control'))return;if(!closeDetail()){event.preventDefault();event.stopPropagation()}},true);
document.addEventListener('keydown',event=>{if(event.key!=='Escape'||$('status-dialog').open||$('accounts-dialog').open||$('help-dialog').open||$('hidden-places-dialog').open)return;if(!$('detail').hidden){event.preventDefault();closeDetail(true)}else if($('places-panel').classList.contains('mobile-open')){setSidebar(false);$('mobile-toggle').focus()}});
window.addEventListener('resize',()=>{if(map)map.resize()});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
document.addEventListener('visibilitychange',async()=>{if(document.hidden||!data||dirty||busy)return;try{const id=selected;await load();if(id&&data.places.some(p=>p.id===id))detail(data.places.find(p=>p.id===id))}catch(e){toast(e.message)}});
$('export-data').onclick=exportData;
placeUI=createPlaceLifecycleUI({api,$,esc,getData:()=>data,toast,onBusy:value=>{busy=value},canOpen:()=>{if(dirty||busy){toast('Сначала сохраните изменения.');return false}return true},canChange:(place,question)=>{if(busy)return false;const warning=dirty?'Несохранённые изменения в карточке будут потеряны.':'';return !(question||warning)||window.confirm([question,warning].filter(Boolean).join('\n\n'))},onChange:(place,action)=>{if(place.id===selected){dirty=false;selected=null;$('detail').hidden=true;$('application').classList.remove('detail-open')}data.places=data.places.filter(p=>p.id!==place.id);if(action==='restore')data.places.push(place);populateFilters();$('verified').textContent=hoursOverview(data.places);render()}});
accountUI=createAccountUI({api,$,esc,load,toast,getData:()=>data,canOpen:()=>{if(dirty||busy){toast('Сначала сохраните изменения.');return false}return true}});
startup=createAuthStartup({initialize:signal=>accountUI.init(signal),load:signal=>load({signal}),onLoading:()=>{$('login').hidden=false;$('auth-content').hidden=true;$('auth-loading').hidden=false;$('auth-loading-message').textContent='Загружаем карту…';$('auth-retry').hidden=true},onLogin:showLogin,onError:message=>{$('auth-loading-message').textContent=message;$('auth-retry').hidden=false}});
$('auth-retry').onclick=()=>startup.run();
if(configurationError){$('auth-loading-message').textContent=configurationError}else void startup.run();
