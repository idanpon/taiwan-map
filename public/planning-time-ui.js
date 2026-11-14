import {dateLabel,validDate} from './planning-model.js';
import {initialZone,localPoint,localInstants,tripLocalInstants,resolveLocalChoice,offsetLabel,validClock,namedZone,minute} from './trip-timezones.js';
import {dateInput,dateValue} from './date-picker.js';

const icon=(path,classes='')=>`<svg class="timezone-icon ${classes}" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
const arrow=icon('<path d="M5 12h14m-6-6 6 6-6 6"/>');
const clockAlert=icon('<path d="M12 8v4l2 2m7-3v4m0 4h.01M18 19a9 9 0 1 1 3-9"/>');
const bellOff=icon('<path d="m3 3 18 18M10 21a2 2 0 0 0 4 0M6 9c0 6-3 6-3 8h14m1-6V8a6 6 0 0 0-9-5"/>');
export const timezoneExplanation='Календарь показывает местное время по общему плану поездки. До указанного момента смены действует предыдущий пояс, затем календарь переключается на новый. Даты без времени остаются теми же.';
export const pointText=p=>p?dateLabel(p.day)+' · '+p.time+' · '+p.badge:'';
export const zoneBadge=(p,esc,control='planning-item-zone-help')=>`<button class="timezone-badge ui-button-feedback" type="button" data-zone-toggle="${control}" aria-expanded="false" aria-controls="${control}" title="${esc(p.zone)} · Как выбирается пояс">${esc(p.badge)}</button>`;
function delta(point,previous){
 if(!point||!previous)return '';
 const difference=Math.round((point.at-previous.at)/minute);
 if(!difference)return 'Без сдвига';
 const number=Math.abs(difference),hours=Math.floor(number/60),minutes=number%60;
 return 'На '+[hours?hours+' ч':'',minutes?minutes+' мин':''].filter(Boolean).join(' ')+(difference<0?' раньше':' позже');
}
function choiceGroup({id,title,check,before},esc){
 const previous=before||check.previous,jump=check.jump;
 const frame=p=>p?`<div><strong>${esc(p.time)}</strong><span>${esc(p.badge)}</span></div>`:'';
 const preset=(kind,label,p)=>`<label class="time-choice"><input name="pick-${esc(id)}" type="radio" value="${kind}" ${p&&p.at>Date.now()?'':'disabled'}><span><strong>${label}</strong><small>${p?esc(pointText(p)):'Нет доступного времени'}</small>${p?`<small class="time-delta">${esc(p.at>Date.now()?delta(p,previous):'Это время уже прошло')}</small>`:''}</span></label>`;
 return `<section class="time-review-group" data-review-id="${esc(id)}">
 <div class="time-review-warning">${clockAlert}<p>Местное время <strong>${esc(check.time)}</strong> ${check.kind==='gap'?'пропускается':'встречается дважды'} из-за смены пояса. Уточните время напоминания.</p></div>
 ${jump?`<div class="time-review-jump" aria-label="Часы при переходе">${frame(jump.before)}${arrow}${frame(jump.after)}</div>`:''}
 <section class="time-review-event"><h3>${esc(title)}</h3><p>${esc(dateLabel(check.day))} · выбрано ${esc(check.time)}${previous?' · было '+esc(pointText(previous)):''}</p></section>
 <fieldset><legend>Когда отправить напоминание?</legend>${previous?'<p class="muted">Сдвиг — относительно сохранённого момента отправки.</p>':''}
 ${preset('before','До перехода',check.before)}
 ${preset('after','После перехода',check.after)}
 <div class="time-choice time-choice-custom"><label><input name="pick-${esc(id)}" type="radio" value="custom"><span><strong>Своё время</strong><small>Указать другое время отправки</small></span></label><div data-time-custom hidden><div class="time-field-grid"><label>Время<input class="ui-field ui-field--soft" type="time" data-custom-time step="60"></label><label>Часовой пояс<select class="ui-field ui-field--soft" data-custom-zone aria-label="Пояс своего времени"></select></label></div><p class="time-delta" data-custom-message aria-live="polite"></p></div></div>
 <label class="time-choice time-choice-off"><input name="pick-${esc(id)}" type="radio" value="off"><span><strong>Не отправлять</strong><small>Напоминание этого события будет выключено</small></span>${bellOff}</label></fieldset></section>`;
}
export function createTimeReview({scroller,content,title,error,esc,setBusy,setDirty}){
 function show({mine,others,plan,back,save,caption}){
  const draft=document.createDocumentFragment(),oldTitle=title.textContent,scroll=scroller.scrollTop;
  while(content.firstChild)draft.append(content.firstChild);
  title.textContent='Проверка времени';error.textContent='';
  const ambiguous=mine.filter(row=>row.check),simple=mine.filter(row=>!row.check);
  content.innerHTML=`<form class="time-review">
   ${ambiguous.map(row=>choiceGroup(row,esc)).join('')}
   ${simple.length?`<section class="time-review-shifts"><h3>Сдвиги моих напоминаний</h3>${simple.map(row=>`<p><strong>${esc(row.title)}</strong><br><span class="muted">${esc(pointText(row.before))} → ${esc(row.willSkip?'время уже прошло; уточните напоминание':pointText(row.next))}</span></p>`).join('')}</section>`:''}
   ${others?.shifted||others?.frozen?`<div class="time-review-warning">${clockAlert}<p><strong>Напоминания других участников</strong><br>${others.shifted?'Пересчитаются: '+others.shifted+'. ':''}${others.frozen?'Сохранят прежний момент отправки: '+others.frozen+'. Владельцы увидят пометку «Уточните время».':''}</p></div>`:''}
   ${caption?`<p class="muted">${esc(caption)}</p>`:''}<p class="ui-error time-review-error" role="alert"></p>
   <div class="time-review-footer"><button class="ui-button" type="button" data-review-back>Назад</button><button class="ui-button ui-button--primary" type="submit" data-review-save>Сохранить изменения</button></div></form>`;
  const form=content.querySelector('form'),submit=form.querySelector('[data-review-save]');
  const groups=[...form.querySelectorAll('[data-review-id]')];
  function collect(){
   const choices={};
   for(const [index,group] of groups.entries()){
    const row=ambiguous[index],{check}=row;
    const kind=group.querySelector('input[type=radio]:checked')?.value,custom=group.querySelector('[data-time-custom]');
    custom.hidden=kind!=='custom';
    if(!kind)continue;
    if(kind!=='custom'){choices[row.id]={kind};continue}
    const time=custom.querySelector('[data-custom-time]').value,select=custom.querySelector('[data-custom-zone]');
    const values=validClock(time)?tripLocalInstants(check.day,time,plan).map(at=>localPoint(at,plan)):[];
    const previous=select.value;
    select.replaceChildren(new Option(values.length?'Выберите пояс':'Укажите существующее время',''),...values.map(p=>new Option(p.badge,p.zone+'|'+p.offset)));
    select.disabled=!values.length;
    if(values.length===1)select.selectedIndex=1;
    else if([...select.options].some(o=>o.value===previous))select.value=previous;
    const [zone,offset]=select.value.split('|');
    const choice={kind,time,zone,offset:Number(offset)},point=resolveLocalChoice(check,choice,plan);
    const text=custom.querySelector('[data-custom-message]');
    text.textContent=!time?'':!values.length?'Такого местного времени нет. Выберите другое.':!point?'Выберите одно из смещений UTC.':point.at<=Date.now()?'Это время уже прошло.':delta(point,row.before||check.previous)||pointText(point);
    if(point&&point.at>Date.now())choices[row.id]=choice;
   }
   submit.disabled=Object.keys(choices).length!==ambiguous.length;
   return choices;
  }
  form.addEventListener('input',collect);form.addEventListener('change',collect);
  const previousStep=()=>{
   content.replaceChildren(draft);title.textContent=oldTitle;error.textContent='';scroller.scrollTop=scroll;title.focus({preventScroll:true});
  };
  form.querySelector('[data-review-back]').onclick=()=>{previousStep();back?.()};
  form.onsubmit=async e=>{
   e.preventDefault();const choices=collect();if(submit.disabled)return;
   const backButton=form.querySelector('[data-review-back]');
   submit.disabled=backButton.disabled=true;setBusy(true);
   try{await save(choices,previousStep)}catch(e){form.querySelector('[role=alert]').textContent=e.message}
   finally{setBusy(false);backButton.disabled=false;collect()}
  };
  setDirty(true);collect();scroller.scrollTop=0;title.focus({preventScroll:true});
 }
 return {show};
}

export function itemDateEditor(item,plan,esc,{showFixed=true}={}){
 const start=item.starts_at?localPoint(item.starts_at,plan):null,end=item.ends_at?localPoint(item.ends_at,plan):null;
 const first=start?.day||item.date_start||item.date_end||'',last=end?.day||item.date_end||'';
 const mode=(end&&start||item.date_start&&item.date_end&&item.date_start!==item.date_end)?'period':first?'day':'none';
 const html=`<fieldset class="planning-item-dates ui-fieldset" data-standard-dates><legend>Дата или период</legend>
 <label>Когда<select class="ui-field ui-field--soft" name="date_mode" aria-label="Когда"><option value="none" ${mode==='none'?'selected':''}>Без даты</option><option value="day" ${mode==='day'?'selected':''}>Один день или дедлайн</option><option value="period" ${mode==='period'?'selected':''}>Период</option></select></label>
 <div data-dated-fields><div class="form-columns">${dateInput('date_start',first,'Дата')}<div data-period-field>${dateInput('date_end',last,'Окончание')}</div></div>
 <label class="inline-check"><input type="checkbox" name="exact_time" ${start||end?'checked':''}> Указать точное время</label>
 <div class="form-columns" data-exact-fields><div><label><span data-time-label>Время</span><input class="ui-field ui-field--soft" name="start_time" type="time" value="${esc(start?.time||end?.time||'')}"></label><div data-clock-info="start"></div></div>
 <div data-period-field><label>Время окончания<input class="ui-field ui-field--soft" name="end_time" type="time" value="${esc(end?.time||'')}"></label><div data-clock-info="end"></div></div></div>
 <p class="muted">Время местное, по плану поездки. Для периода нужны обе даты, а при точном времени — и оба времени.</p></div>
 ${showFixed?`<label class="inline-check"><input name="fixed_external" type="checkbox" ${item.fixed_external?'checked':''}> Фиксированная внешняя дата / время</label>`:''}</fieldset>`;
 const selected={start:null,end:null};
 function mount(form){
  const f=form.elements,field=form.querySelector('.planning-item-dates');
  function redraw(){
   const dated=f.date_mode.value!=='none',period=f.date_mode.value==='period',timed=dated&&f.exact_time.checked;
   field.querySelector('[data-dated-fields]').hidden=!dated;
   field.querySelector('[data-exact-fields]').hidden=!timed;
   for(const el of field.querySelectorAll('[data-period-field]'))el.hidden=!period;
   f.date_start.labels[0].textContent=period?'Начало':'Дата';
   field.querySelector('[data-time-label]').textContent=period?'Время начала':'Время';
   f.date_start.required=dated;f.date_end.required=period;f.start_time.required=timed;f.end_time.required=timed&&period;
   f.date_start.disabled=!dated;f.date_end.disabled=!period;f.start_time.disabled=!timed;f.end_time.disabled=!timed||!period;
   for(const [side,old,original] of [['start',start,item.starts_at],['end',end,item.ends_at]]){
    const box=field.querySelector('[data-clock-info="'+side+'"]'),day=dateValue(f['date_'+side]),time=f[side+'_time'].value;
    const picked=box.querySelector('select')?.value||String(selected[side]?.at??'');
    box.replaceChildren();selected[side]=null;
    if(!timed||side==='end'&&!period||!validDate(day)||!validClock(time))continue;
    const matches=old?.day===day&&old.time===time?[old.at]:tripLocalInstants(day,time,plan);
    if(matches.length===1){
     selected[side]=localPoint(matches[0],plan);selected[side].iso=old?.at===matches[0]?original:new Date(matches[0]).toISOString();
     box.innerHTML=zoneBadge(selected[side],esc,'planning-form-zone-help');
    }else if(matches.length>1){
     const select=document.createElement('select');select.className='ui-field ui-field--soft';select.setAttribute('aria-label',side==='start'?'Пояс времени начала':'Пояс времени окончания');
     select.add(new Option('Время встречается дважды: выберите пояс',''));
     for(const at of matches)select.add(new Option(localPoint(at,plan).badge,String(at)));
     if(matches.map(String).includes(picked))select.value=picked;
     select.oninput=()=>{selected[side]=select.value?{...localPoint(Number(select.value),plan),iso:new Date(Number(select.value)).toISOString()}:null};
     select.oninput();box.append(select);
    }else box.innerHTML='<p class="planning-warning">Это время пропускается. Выберите другое.</p>';
   }
  }
  field.insertAdjacentHTML('beforeend',`<p id="planning-form-zone-help" class="muted" hidden>${timezoneExplanation}</p>`);
  for(const name of ['date_mode','exact_time','date_start','date_end','start_time','end_time'])f[name].addEventListener('input',redraw);
  redraw();
 }
 function values(form){
  const f=form.elements,mode=f.date_mode.value,exact=mode!=='none'&&f.exact_time.checked;
  const first=dateValue(f.date_start),last=dateValue(f.date_end);
  if((mode!=='none'&&!first)||(mode==='period'&&!last))throw new Error('Укажите дату или обе даты периода.');
  if(exact&&(!selected.start||mode==='period'&&!selected.end))throw new Error('Уточните точное время и его пояс.');
  if(mode==='period'&&(exact?selected.end.at<selected.start.at:last<first))throw new Error('Окончание должно быть не раньше начала.');
  return {date_start:mode==='none'?null:first,date_end:mode==='period'?last:null,
   starts_at:exact?selected.start.iso:null,ends_at:exact&&mode==='period'?selected.end.iso:null,event_timezone:exact?selected.start.zone:item.event_timezone||initialZone.zone};
 }
 return {html,mount,values};
}

const commonZones=new Map([
 ['Europe/Moscow','Москва'],
 ['Asia/Taipei','Тайбэй (Тайвань)'],
 ['Asia/Shanghai','Китай (Пекин, Шанхай)'],
 ['Asia/Hong_Kong','Гонконг'],
 ['Asia/Tokyo','Токио'],
 ['Asia/Seoul','Сеул'],
 ['Asia/Bangkok','Бангкок'],
 ['Asia/Dubai','Дубай'],
 ['UTC','UTC']
]);
const zoneRegions={
 Africa:'Африка',America:'Америка',Antarctica:'Антарктика',Arctic:'Арктика',
 Asia:'Азия',Atlantic:'Атлантика',Australia:'Австралия',Europe:'Европа',
 Indian:'Индийский океан',Pacific:'Тихий океан',other:'Другие пояса'
};
export function zoneOptions(changes,esc){
 const option=(zone,label)=>`<option value="${esc(zone)}">${esc(label)}</option>`;
 // Keep saved identifiers selectable even if the browser omits them from its list.
 const zones=new Set([...(Intl.supportedValuesOf?.('timeZone')||[]),...changes.map(change=>change.zone)]);
 const groups=new Map(Object.keys(zoneRegions).map(region=>[region,[]]));
 for(const zone of [...zones].sort()){
  if(commonZones.has(zone))continue;
  const [region,...place]=zone.split('/');
  const label=groups.has(region)?place.join(' / '):zone;
  (groups.get(region)||groups.get('other')).push(option(zone,label.replaceAll('_',' ')));
 }
 const common=[...commonZones].map(([zone,label])=>option(zone,label)).join('');
 const regional=[...groups].filter(([,options])=>options.length)
  .map(([region,options])=>`<optgroup label="${zoneRegions[region]}">${options.join('')}</optgroup>`).join('');
 return `<option value="">Выберите пояс</option><optgroup label="Частые пояса">${common}</optgroup>${regional}`;
}
export function editTripTime({trip,plan,esc,showDialog,dialog,setBusy,setDirty,error,api,load,review,toast}){
 const optionsHtml=zoneOptions(plan.changes,esc);
 showDialog('Даты поездки и часовые пояса',`<form id="planning-trip-form" class="planning-form">
 ${dateInput('departure_date',trip.departure_date,'Вылет')}<div class="form-columns">${dateInput('start_date',trip.start_date,'Начало пребывания')}${dateInput('end_date',trip.end_date,'Окончание')}</div>
 <section class="trip-zone-editor"><h3>Часовые пояса поездки</h3><p class="muted">Выберите новый пояс и укажите дату и время смены по его местным часам. В этот момент календарь переключится на новый пояс. Смену можно запланировать, например, за час до посадки.</p>
 <div class="trip-zone-initial"><strong>Москва</strong><span class="timezone-badge">Europe/Moscow · UTC+3</span></div><div data-zone-changes></div>
 <button type="button" class="ui-button ui-button--quiet ui-button--compact" data-zone-change-add>＋ Добавить смену пояса</button></section>
 <p class="muted">Даты задач и маршрута не переносятся автоматически. Связанные переносы можно обсудить в чате.</p><button class="ui-button ui-button--primary" type="submit">Продолжить</button></form>`,{system:true});
 const form=dialog.querySelector('#planning-trip-form'),zoneChanges=form.querySelector('[data-zone-changes]');
 for(const name of ['departure_date','start_date','end_date'])form.elements[name].required=true;
 function append(change){
  const row=document.createElement('fieldset'),p=change?localPoint(change.at,{changes:[change]}):null;
  row.className='trip-zone-change ui-fieldset';
  row.innerHTML=`<legend>Смена часового пояса</legend>
   <div class="form-columns trip-zone-details"><label>Новый часовой пояс<select class="ui-field ui-field--soft" name="zone" required>${optionsHtml}</select></label><label>Регион (необязательно)<input class="ui-field ui-field--soft" name="region" value="${esc(p?.region||'')}" maxlength="60" placeholder="Тайвань"></label></div>
   <div class="form-columns">${dateInput('day',p?.day||trip.start_date,'Дата смены')}<label>Время смены<input class="ui-field ui-field--soft" type="time" name="time" value="${esc(p?.time||'')}" required></label></div>
   <div data-zone-offset></div><button type="button" class="ui-button ui-button--quiet ui-button--compact" data-zone-change-remove>Убрать смену пояса</button>`;
  const {day,time,zone}=row.elements;
  day.required=true;
  zone.value=p?.zone||'';
  zoneChanges.append(row);
  const update=()=>{
   const offset=row.querySelector('[data-zone-offset]'),old=offset.querySelector('select')?.value||(p?.at??'');
   offset.replaceChildren();
   const date=dateValue(day);
   if(!validDate(date)||!validClock(time.value)||!zone.value)return;
   const options=localInstants(date,time.value,zone.value);
   if(!options.length){offset.innerHTML='<p class="planning-warning">Такого местного времени нет. Укажите другое время.</p>';return}
   if(options.length===1){offset.textContent=offsetLabel(localPoint(options[0],{changes:[{at:options[0],zone:zone.value,region:''}]}).offset);return}
   const label=document.createElement('label'),select=document.createElement('select');
   label.textContent='Время встречается дважды. Уточните смещение UTC';
   select.className='ui-field ui-field--soft';select.name='at';select.required=true;select.add(new Option('Выберите смещение',''));
   for(const at of options)select.add(new Option(offsetLabel(localPoint(at,{changes:[{at,zone:zone.value,region:''}]}).offset),String(at)));
   if(options.map(String).includes(String(old)))select.value=String(old);
   label.append(select);offset.append(label);
  };
  day.addEventListener('input',update);
  time.addEventListener('input',update);
  zone.addEventListener('change',update);
  row.querySelector('[data-zone-change-remove]').onclick=()=>{row.remove();setDirty(true)};
  update();return row;
 }
 for(const change of plan.changes)append(change);
 form.oninput=()=>setDirty(true);
 form.querySelector('[data-zone-change-add]').onclick=()=>{
  if(zoneChanges.children.length>=30){error.textContent='Можно задать до 30 смен пояса.';return}
  setDirty(true);append().querySelector('[name=zone]').focus();
 };
 const request=(path,method,value)=>api(path,{method,body:JSON.stringify(value)});
 async function apply(draft,preview,choices){
  const result=await request('/api/planning/timezones','PUT',{...draft,fingerprint:preview.fingerprint,choices});
  setDirty(false);dialog.close();await load();toast('Даты и часовые пояса сохранены.');return result;
 }
 function display(draft,preview){
  const reviewPlan={changes:draft.changes.map(change=>({at:change.at,zone:change.zone,region:change.region})).sort((a,b)=>a.at-b.at)};
  review.show({...preview,plan:reviewPlan,save:async(choices,back)=>{
   try{await apply(draft,preview,choices)}
   catch(e){
    if(e.details?.code==='timezone_preview_stale'){back();display(draft,e.details.preview)}
    else throw e;
   }
  }});
 }
 form.onsubmit=async e=>{
  e.preventDefault();error.textContent='';
  const fields=form.elements,dates=Object.fromEntries(['departure_date','start_date','end_date'].map(k=>[k,dateValue(fields[k])]));
  let changes;
  try{
   if(Object.values(dates).some(date=>!date))throw new Error('Укажите даты вылета, начала и окончания поездки.');
   changes=[...zoneChanges.children].map(row=>{
    const day=dateValue(row.elements.day),time=row.elements.time.value,zone=row.elements.zone.value,region=row.elements.region.value.trim();
    if(!namedZone(zone))throw new Error('Выберите часовой пояс из списка.');
    const list=localInstants(day,time,zone),at=list.length===1?list[0]:Number(row.elements.at?.value);
    if(!list.includes(at))throw new Error('Уточните местное время смены пояса и его смещение.');
    return {day,time,zone,region,at};
   });
   if(new Set(changes.map(change=>change.at)).size!==changes.length)throw new Error('Укажите отдельный момент для каждой смены пояса.');
  }catch(e){error.textContent=e.message;return}
  const draft={...dates,version:trip.version,timezone_revision:plan.revision,changes},button=form.querySelector('[type=submit]');
  setBusy(true);button.disabled=true;
  try{
   const preview=await request('/api/planning/timezones/preview','POST',draft);
   if(preview.mine.length||preview.others.shifted||preview.others.frozen)display(draft,preview);
   else await apply(draft,preview,{});
  }catch(e){error.textContent=e.message}
  finally{setBusy(false);button.disabled=false}
 };
}
