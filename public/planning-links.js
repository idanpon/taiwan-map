import {dateLabel,itemDates,stateLabels,kindLabels} from './planning-model.js';
import {when} from './planning-presentation.js';
export function planningPlaceSummary(plan,placeId,esc){
 if(plan?.schema_version===3){const s=plan.sources,ids=new Set(s.placement_places.filter(l=>l.archived_at==null&&l.place_id===placeId).map(l=>l.placement_id)),rows=s.placements.filter(p=>ids.has(p.id)&&plan.working.placement_ids.includes(p.id));return rows.length?`<section class="map-planning-relations"><h3>В рабочем маршруте</h3>${rows.map(p=>`<a class="map-planning-link" href="./planning.html#placement=${encodeURIComponent(p.id)}"><strong>${esc(s.items.find(i=>i.id===p.item_id)?.title||'Пункт')}</strong><span>${esc(when(p))}${p.commitment==='approved'?' · Утверждено':' · Предварительно'}</span></a>`).join('')}</section>`:'';}
 if(!plan)return '';const items=plan.items.filter(i=>i.places.some(l=>l.place_id===placeId)&&i.state!=='cancelled').sort((a,b)=>(a.date_end||a.date_start||'9999').localeCompare(b.date_end||b.date_start||'9999'));
 if(!items.length)return '';
 const renderItem=i=>{const [start,end]=itemDates(i,Intl.DateTimeFormat().resolvedOptions().timeZone);return `<a class="map-planning-link" href="./planning.html#item=${encodeURIComponent(i.id)}"><strong>${esc(i.title)}</strong><span>${esc(kindLabels[i.kind])} · <span class="ui-status" data-state="${esc(i.state)}">${esc(stateLabels[i.state])}</span> · ${start?esc(dateLabel(start)+(end!==start?' — '+dateLabel(end):'')):'Без срока'}</span></a>`};
 return `<section class="map-planning-relations"><h3>В плане поездки</h3>${items.slice(0,3).map(renderItem).join('')}${items.length>3?`<details><summary>Ещё ${items.length-3} связанных записей</summary>${items.slice(3).map(renderItem).join('')}</details>`:''}</section>`;
}
export function planningConflictContent(details,esc){return `<p class="planning-status-conflict">Статус меняется через решение в календаре.${(details?.decisions||[]).map(i=>`<a href="./planning.html#item=${encodeURIComponent(i.id)}">${esc(i.title)} →</a>`).join('')}</p>`}

// Optional calendar enrichment must never hold up map/authentication startup.
// Ignore a late response after logout or a newer data load.
export async function hydratePlanningLinks({api,current,getCurrent,onReady,onError,signal}){
 try{const legacy=await api('/api/planning?model=2',{signal});if(getCurrent()!==current)return;const plan=legacy.model_version===3?await api('/api/planning?model=3',{signal}):legacy;if(getCurrent()===current)onReady(plan)}
 catch(error){if(getCurrent()===current&&error.status!==404&&error.name!=='AbortError')onError(error)}
}
