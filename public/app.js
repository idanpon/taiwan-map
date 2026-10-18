import {createApiClient} from './api-client.js';
const $=id=>document.getElementById(id);
const config=window.TAIWAN_CONFIG||{apiBase:'',requiresApi:false};
let apiBase='',configurationError='';
try {
 if(config.apiBase){const url=new URL(config.apiBase);const normalized=url.origin+url.pathname.replace(/\/$/,'');if(url.protocol!=='https:'||normalized!==config.apiBase||url.search||url.hash||url.username||url.password||!/^[a-zA-Z0-9/_-]*$/.test(url.pathname))throw new Error();apiBase=normalized}
 else if(config.requiresApi)configurationError='Сервер данных ещё не подключён. Адрес API будет добавлен после настройки VPS.';
}catch{configurationError='В настройках сайта указан некорректный HTTPS-адрес API.'}

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shapes={landmark:'<path d="M3 10h18L12 3 3 10Zm2 3v6m5-6v6m4-6v6m5-6v6M3 21h18"/>',museum:'<path d="M3 20h18M5 20V9m14 11V9M8 20V9m8 11V9M3 9h18L12 3 3 9Z"/>',coffee:'<path d="M4 8h12v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Zm12 1h2a3 3 0 0 1 0 6h-2M7 3v2m5-2v2M2 22h17"/>',utensils:'<path d="M5 3v6a3 3 0 0 0 6 0V3M8 3v19M19 22V3c-4 2-4 9 0 9M5 7h6"/>',bag:'<path d="M5 7h14l2 14H3L5 7Zm3 0V5a4 4 0 0 1 8 0v2"/>',leaf:'<path d="M20 3C8 2 2 8 5 15c3 7 16 2 15-12ZM4 21l12-13m-6 6H6m8-4V6"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${shapes[name]||shapes.landmark}</svg>`;
let data,map,layers,positionLayer,accuracyLayer,selected=null,city='',types=new Set(),status='',query='',dirty=false,busy=false,lastZoomGroup=false;
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5500)}
let sessionStorageForApp;try{sessionStorageForApp=window.sessionStorage}catch{}
const transport=createApiClient({apiBase,authMode:config.authMode||'cookie',storage:sessionStorageForApp,onUnauthorized:()=>showLogin()});
async function api(path,options={}){if(configurationError)throw new Error(configurationError);return transport(path,options)}
async function exportData(event){event.preventDefault();try{const content=await api('/api/export');const blob=new Blob([JSON.stringify(content,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='taiwan-map.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){toast(e.message)}}
function showLogin(){$('application').hidden=true;$('application').classList.remove('detail-open');document.body.classList.remove('app-active');setSidebar(false);$('detail').hidden=true;$('login').hidden=false;data=null;selected=null;dirty=false;if(map){map.remove();map=null}}
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
// Display palette also recognizes the custom status by its user-facing name.
const statusColors={hype:'#dc2626',want:'#1456e0',maybe:'#facc15',visited:'#6b7280'};
const statusSymbols={want:'!',visited:'✓',maybe:'?'};
function getStatus(p){
 const value=data.statuses.find(s=>s.id===p.status_id);if(!value)return undefined;
 const label=value.label.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const key=label==='хайп'||label==='hype'?'hype':value.id;
 const color=statusColors[key]||value.color;
 return {...value,color,symbol:statusSymbols[key]||'',symbolColor:key==='maybe'?'#422006':'#ffffff',textColor:key==='maybe'?'#806000':color};
}
function visible(){return data.places.filter(p=>(!city||p.city===city)&&(!types.size||types.has(p.category_id))&&(!status||(status==='none'?!p.status_id:p.status_id===status))&&(!query||`${p.name} ${p.local_name} ${p.summary} ${p.address}`.toLowerCase().includes(query)))}
function populateFilters(){
 $('category-filters').innerHTML=data.categories.map(c=>`<button class="chip ${types.has(c.id)?'active':''}" data-category="${esc(c.id)}" aria-pressed="${types.has(c.id)}">${icon(c.icon)}${esc(c.label)}</button>`).join('');
 const previous=$('status-filter').value;$('status-filter').innerHTML='<option value="">Все статусы</option><option value="none">Без статуса</option>'+data.statuses.map(s=>`<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('');$('status-filter').value=previous;
}
function render(){if(!data)return;const ps=visible();$('place-count').textContent=`${ps.length} из ${data.places.length} мест`;$('map-label').textContent=`${city||'Тайвань'} · ${ps.length} мест`;
 $('place-list').innerHTML=ps.length?ps.map(p=>{const c=getCategory(p),s=getStatus(p);return `<button class="place-card ${selected===p.id?'selected':''}" data-place="${esc(p.id)}" style="--category:${c.color};--category-bg:${c.color}14;--status:${s?.color||'#697568'};--status-text:${s?.textColor||'#697568'}"><span class="place-icon">${icon(c.icon)}</span><span class="place-card-content"><span class="place-name">${esc(p.name)}</span><span class="place-meta">${esc(p.city)} <span>·</span> ${esc(c.label)}</span><span class="card-status"><i class="status-dot"></i> ${esc(s?.label||'Без статуса')}</span></span></button>`}).join(''):'<p class="empty">Под эти фильтры пока нет мест.<br>Попробуйте другой статус или сбросьте фильтры.</p>';
 if(selected&&!ps.some(p=>p.id===selected)){selected=null;$('detail').hidden=true;$('application').classList.remove('detail-open');dirty=false}renderMarkers(ps);
}
function renderMarkers(ps=visible()){
 if(!map||!layers)return;layers.clearLayers();lastZoomGroup=map.getZoom()<10;
 if(lastZoomGroup){for(const name of [...new Set(ps.map(p=>p.city))]){const group=ps.filter(p=>p.city===name),lat=group.reduce((s,p)=>s+p.lat,0)/group.length,lon=group.reduce((s,p)=>s+p.lon,0)/group.length;L.marker([lat,lon],{icon:L.divIcon({className:'pin-shell',html:`<div class="city-cluster">${group.length}</div>`,iconSize:[45,45],iconAnchor:[22,22]}),title:name}).addTo(layers).bindTooltip(`${name} · ${group.length} мест`).on('click',()=>map.fitBounds(group.map(p=>[p.lat,p.lon]),{padding:[60,60],maxZoom:14}));}return}
 for(const p of ps){const c=getCategory(p),s=getStatus(p);const pin=L.divIcon({className:'pin-shell',html:`<div class="pin ${p.status_id==='visited'?'visited':''}" style="--category:${c.color};--status:${s?.color||c.color};--status-symbol:${s?.symbolColor||'#ffffff'}">${icon(c.icon)}${s?`<i class="pin-state" aria-hidden="true">${s.symbol}</i>`:''}</div>`,iconSize:[40,40],iconAnchor:[20,20]});const label=p.name+(s?' · '+s.label:'');L.marker([p.lat,p.lon],{icon:pin,title:label,alt:label,keyboard:true,riseOnHover:true,zIndexOffset:selected===p.id?500:0}).addTo(layers).bindTooltip(esc(label),{direction:'top',offset:[0,-22]}).on('click',()=>openPlace(p.id))}
}
function initMap(){
 if(!window.L){$('map-error').hidden=false;return}
 map=L.map('map',{zoomControl:false}).setView([25.038,121.541],13);L.control.zoom({position:'topright'}).addTo(map);layers=L.layerGroup().addTo(map);
 const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(map);let failures=0;tiles.on('tileerror',()=>{if(++failures>=4)$('map-error').hidden=false});tiles.on('tileload',()=>{$('map-error').hidden=true;failures=0});map.on('zoomend',()=>{if((map.getZoom()<10)!==lastZoomGroup)renderMarkers()});
}
function fit(){const ps=visible();if(map&&ps.length)map.fitBounds(ps.map(p=>[p.lat,p.lon]),{padding:[60,70],maxZoom:14})}
function detail(p){const c=getCategory(p),s=getStatus(p);$('detail').style.setProperty('--category',c.color);
 $('detail').innerHTML=`<div class="detail-header"><p class="eyebrow">${esc(p.city)} / ${esc(c.label)}</p><button type="button" class="detail-close" id="detail-close" aria-label="Закрыть карточку">×</button></div><div class="detail-body"><h2>${esc(p.name)}</h2><p class="local-name">${esc(p.local_name)}</p><p class="detail-summary">${esc(p.summary)}</p><div class="detail-info"><strong>Часы · Тайвань (UTC+8)</strong><p>${esc(p.hours.label)}</p>${p.hours.note?`<p class="hours-note">${esc(p.hours.note)}</p>`:''}<strong>Адрес</strong><p>${esc(p.address)}</p></div><p class="tip">${esc(p.tip)}</p><a class="google-link" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name+' '+p.address)}">Открыть в Google Maps ↗</a><div class="detail-links">${p.links.filter(l=>/^https:\/\//.test(l.url)).map(l=>`<a target="_blank" rel="noopener noreferrer" href="${esc(l.url)}">${esc(l.label)} ↗</a>`).join('')}</div><form id="state-form"><label for="place-status">Наш статус</label><select id="place-status"><option value="">Без статуса</option>${data.statuses.map(s=>`<option value="${esc(s.id)}" ${s.id===p.status_id?'selected':''}>${esc(s.label)}</option>`).join('')}</select><label for="place-note">Заметка к месту</label><textarea id="place-note" maxlength="2000" placeholder="Что попробовать или не забыть">${esc(p.note)}</textarea><button type="submit" id="save-state" class="primary">Сохранить</button></form><p class="verification">Часы проверены ${new Date(p.verified_at+'T12:00:00Z').toLocaleDateString('ru-RU')}. В праздники возможны изменения.</p></div>`;
 $('detail').hidden=false;$('application').classList.add('detail-open');$('detail-close').onclick=()=>closeDetail(true);$('state-form').oninput=()=>dirty=true;$('state-form').onsubmit=event=>saveState(event,p);dirty=false;
}
function openPlace(id){if(busy)return;if(dirty){if(id!==selected)toast('Сначала сохраните изменения в открытой карточке.');return}const p=data.places.find(p=>p.id===id);if(!p)return;selected=id;detail(p);render();setSidebar(false);if(map){map.setView([p.lat,p.lon],Math.max(14,map.getZoom()),{animate:false});const rect=$('detail').getBoundingClientRect();const offset=matchMedia('(max-width:1000px)').matches?[0,(map.getContainer().getBoundingClientRect().bottom-rect.top)/2]:[(rect.width+20)/2,0];map.panBy(offset,{animate:!matchMedia('(prefers-reduced-motion: reduce)').matches})}$('detail-close').focus({preventScroll:true})}
async function saveState(event,p){event.preventDefault();if(busy)return;busy=true;const note=$('place-note').value,statusId=$('place-status').value||null;$('save-state').disabled=true;try{const result=await api(`/api/places/${encodeURIComponent(p.id)}/state`,{method:'PUT',body:JSON.stringify({version:p.version,note,status_id:statusId})});Object.assign(p,{note,status_id:statusId,...result});dirty=false;render();toast('Изменения сохранены.')}catch(e){toast(e.message);if(e.status===409){try{data=await api('/api/data');const current=data.places.find(x=>x.id===p.id);populateFilters();render();if(current){detail(current);$('place-note').value=note;if(data.statuses.some(s=>s.id===statusId))$('place-status').value=statusId;dirty=true;toast('Данные обновлены. Ваш текст оставлен в поле: проверьте и сохраните ещё раз.')}}catch(err){toast(err.message)}}}finally{busy=false;if($('save-state'))$('save-state').disabled=false}}
async function load(){data=await api('/api/data');$('login').hidden=true;$('application').hidden=false;document.body.classList.add('app-active');populateFilters();$('verified').textContent='Часы проверены '+new Date(data.verified_at+'T12:00:00Z').toLocaleDateString('ru-RU');if(!map)initMap();render();if(map)setTimeout(()=>map.invalidateSize(),0)}
$('login-form').onsubmit=async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;$('login-error').textContent='';try{await api('/api/login',{method:'POST',body:JSON.stringify({password:$('password').value})});$('password').value='';await load()}catch(err){$('login-error').textContent=err.message}finally{button.disabled=false}};
$('logout').onclick=async()=>{if(dirty){toast('Сначала сохраните изменения.');return}try{await api('/api/logout',{method:'POST'});showLogin()}catch(e){toast(e.message)}};
document.querySelectorAll('[data-city]').forEach(button=>button.onclick=()=>{if(dirty){toast('Сначала сохраните изменения.');return}city=button.dataset.city;document.querySelectorAll('[data-city]').forEach(b=>b.classList.toggle('active',b===button));render();fit()});
$('category-filters').onclick=e=>{const b=e.target.closest('[data-category]');if(!b)return;if(dirty){toast('Сначала сохраните изменения.');return}const id=b.dataset.category;types.has(id)?types.delete(id):types.add(id);populateFilters();render()};
$('status-filter').onchange=e=>{if(dirty){e.target.value=status;toast('Сначала сохраните изменения.');return}status=e.target.value;render()};
$('search').oninput=e=>{if(dirty){toast('Сначала сохраните изменения.');e.target.value=query;return}query=e.target.value.trim().toLowerCase();render()};
$('reset').onclick=()=>{if(dirty){toast('Сначала сохраните изменения.');return}city='';types.clear();status='';query='';$('search').value='';$('status-filter').value='';document.querySelectorAll('[data-city]').forEach(b=>b.classList.toggle('active',b.dataset.city===''));populateFilters();render();fit()};
$('place-list').onclick=e=>{const b=e.target.closest('[data-place]');if(b)openPlace(b.dataset.place)};$('fit').onclick=fit;
$('locate').onclick=()=>{if(!map){toast('Карта недоступна.');return}if(!window.isSecureContext||!navigator.geolocation){toast('Геопозиции нужен HTTPS и поддержка браузера.');return}const button=$('locate');button.disabled=true;navigator.geolocation.getCurrentPosition(p=>{button.disabled=false;const ll=[p.coords.latitude,p.coords.longitude];if(positionLayer)map.removeLayer(positionLayer);if(accuracyLayer)map.removeLayer(accuracyLayer);accuracyLayer=L.circle(ll,{radius:p.coords.accuracy,color:'#5f8fc1',fillOpacity:.08,weight:1}).addTo(map);positionLayer=L.circleMarker(ll,{radius:8,color:'#fff',weight:3,fillColor:'#387fc4',fillOpacity:1}).addTo(map).bindTooltip('Вы здесь');map.setView(ll,15);toast('Ваше положение показано на карте.');},e=>{button.disabled=false;toast(e.code===1?'Доступ к геопозиции запрещён. Разрешите его в настройках браузера.':'Не удалось определить положение. Попробуйте у окна или на улице.')},{enableHighAccuracy:true,timeout:15000,maximumAge:60000})};
$('manage-statuses').onclick=()=>{$('status-error').textContent='';$('status-dialog').showModal();$('status-name').focus()};$('close-status').onclick=()=>$('status-dialog').close();
$('status-form').onsubmit=async e=>{e.preventDefault();const button=e.currentTarget.querySelector('[type=submit]');button.disabled=true;try{const s=await api('/api/statuses',{method:'POST',body:JSON.stringify({label:$('status-name').value,color:$('status-color').value})});data.statuses.push(s);populateFilters();if(selected){const select=$('place-status');const opt=new Option(s.label,s.id);select.add(opt)}$('status-dialog').close();$('status-name').value='';toast('Новый статус добавлен.')}catch(err){$('status-error').textContent=err.message}finally{button.disabled=false}};
$('mobile-toggle').onclick=()=>{if(!closeDetail())return;setSidebar(!$('places-panel').classList.contains('mobile-open'));if(map)setTimeout(()=>map.invalidateSize(),0)};
document.addEventListener('click',event=>{if($('detail').hidden||$('status-dialog').open||event.target.closest('#detail, #status-dialog, #manage-statuses, [data-place], .leaflet-marker-icon'))return;if(!closeDetail()){event.preventDefault();event.stopPropagation()}},true);
document.addEventListener('keydown',event=>{if(event.key!=='Escape'||$('status-dialog').open)return;if(!$('detail').hidden){event.preventDefault();closeDetail(true)}else if($('places-panel').classList.contains('mobile-open')){setSidebar(false);$('mobile-toggle').focus()}});
window.addEventListener('resize',()=>{if(map)map.invalidateSize({pan:false})});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
document.addEventListener('visibilitychange',async()=>{if(document.hidden||!data||dirty||busy)return;try{const id=selected;await load();if(id&&data.places.some(p=>p.id===id))detail(data.places.find(p=>p.id===id))}catch(e){toast(e.message)}});
$('export-data').onclick=exportData;
if(configurationError){$('login-error').textContent=configurationError;$('password').disabled=true;$('login-form').querySelector('button').disabled=true}else load().catch(e=>{if(e.status!==401)$('login-error').textContent=e.message});
