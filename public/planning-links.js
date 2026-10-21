import {dateLabel,itemDates,stateLabels,kindLabels} from './planning-model.js';
export function planningPlaceSummary(plan,placeId,esc){
 if(!plan)return '';const items=plan.items.filter(i=>i.places.some(l=>l.place_id===placeId)&&i.state!=='cancelled').sort((a,b)=>(a.date_end||a.date_start||'9999').localeCompare(b.date_end||b.date_start||'9999'));
 if(!items.length)return '';
 const renderItem=i=>{const [start,end]=itemDates(i,Intl.DateTimeFormat().resolvedOptions().timeZone);return `<a class="map-planning-link" href="./planning.html#item=${encodeURIComponent(i.id)}"><strong>${esc(i.title)}</strong><span>${esc(kindLabels[i.kind])} · ${esc(stateLabels[i.state])} · ${start?esc(dateLabel(start)+(end!==start?' — '+dateLabel(end):'')):'Без срока'}</span></a>`};
 return `<section class="map-planning-relations"><h3>В плане поездки</h3>${items.slice(0,3).map(renderItem).join('')}${items.length>3?`<details><summary>Ещё ${items.length-3} связанных записей</summary>${items.slice(3).map(renderItem).join('')}</details>`:''}</section>`;
}
export function planningConflictContent(details,esc){return `<p class="planning-status-conflict">Статус меняется через решение в календаре.${(details?.decisions||[]).map(i=>`<a href="./planning.html#item=${encodeURIComponent(i.id)}">${esc(i.title)} →</a>`).join('')}</p>`}

// Optional calendar enrichment must never hold up map/authentication startup.
// Ignore a late response after logout or a newer data load.
export async function hydratePlanningLinks({api,current,getCurrent,onReady,onError,signal}){
 try{const plan=await api('/api/planning',{signal});if(getCurrent()===current)onReady(plan)}
 catch(error){if(getCurrent()===current&&error.status!==404&&error.name!=='AbortError')onError(error)}
}
