import {pushIcon} from './notifications.js';
import {pointText,zoneBadge} from './planning-time-ui.js';
import {localPoint,tripLocalInstants,validClock,minute} from './trip-timezones.js';
import {dateLabel} from './planning-model.js';

const presets={0:'В указанное время',15:'За 15 минут',60:'За 1 час',1440:'За 24 часа'};
const isPreset=value=>Object.hasOwn(presets,value);
const active=item=>['open','in_progress'].includes(item.state);
function offsetLabel(minutes){
 if(isPreset(minutes))return presets[minutes];
 const [days,hours,rest]=[Math.floor(minutes/1440),Math.floor(minutes%1440/60),minutes%60];
 return 'За '+[days?days+' дн.':'',hours?hours+' ч':'',rest?rest+' мин':''].filter(Boolean).join(' ');
}
export function reminderCard({mount,item,plan,notifications,api,esc,review,setDirty,setBusy,toast,openSettings}){
 const path='/api/planning/items/'+encodeURIComponent(item.id)+'/reminder';
 const day=item.date_start||item.date_end,exact=item.starts_at?Date.parse(item.starts_at):null;
 let rule=null,loading=true,error='';
 const eligible=Boolean((day||exact!==null)&&active(item)&&!(item.ends_at&&!item.starts_at));
 const section=mount;
 function deviceInfo(){
  const s=notifications.status();
  const panel=section.querySelector('[data-reminder-devices]');if(!panel)return;
  panel.innerHTML=`<p class="muted">${esc(s.detail)}${s.others?' · Других подключённых устройств: '+s.others+'.':''}</p>
   ${s.paused?'<p class="planning-warning">Пуши на всех ваших устройствах на паузе. Правило сохранится.</p>':s.noDevices?'<p class="planning-warning">Получать пуши пока некуда. Напоминание можно сохранить сейчас и подключить устройство позже.</p>':''}
   <button type="button" class="text-button" data-reminder-settings>Уведомления и устройства</button>`;
  panel.querySelector('[data-reminder-settings]').onclick=openSettings;
 }
 function heading(){return `<h3>${pushIcon} Напомнить мне</h3>`}
 function render(){
  if(!section.isConnected)return;
  if(loading){section.innerHTML=heading()+'<p class="muted">Загружаем напоминание…</p>';return}
  if(error){section.innerHTML=heading()+`<p class="muted">${esc(error)}</p>`;return}
  const s=rule?.scheduled;
  const description=rule?.enabled?(rule.mode==='offset'?offsetLabel(rule.offset_minutes):'В '+(rule.adjusted&&s?s.time+' · время уточнено':rule.local_time)):'Напоминание выключено';
  let note='';
  if(rule?.enabled&&rule.review){
   note=rule.review==='date_changed'?'Дата записи изменилась. Задайте время напоминания заново.':
    'Выбранное местное время '+(rule.review==='gap'?'пропускается':'встречается дважды')+(s?'. Прежний момент отправки сохранён.':'. Задайте время напоминания заново.');
  }
  section.innerHTML=`${heading()}
   ${eligible||rule?.enabled?`<p><strong>${esc(description)}</strong>${rule?.enabled&&s?`<br>${esc(dateLabel(s.day))} · ${esc(s.time)} ${zoneBadge(s,esc)}`:''}</p>`:''}
   ${!eligible?`<p class="muted">${active(item)?'Чтобы включить напоминание, у записи должна быть дата или дата и время.':'Эта запись закрыта. Напоминание не отправляется.'}</p>`:''}
   ${note?`<p class="planning-warning"><strong>Уточните время.</strong> ${esc(note)}</p>`:''}
   ${rule?.enabled&&s&&s.at<=Date.now()?`<p class="muted">${rule.sent?'Напоминание передано push-сервису.':'Время напоминания уже прошло.'}</p>`:''}
   <div class="notification-actions">${eligible?`<button type="button" class="text-button" data-reminder-edit>${rule?.enabled?(rule.review?'Уточнить время':'Изменить напоминание'):'Настроить напоминание'}</button>`:'<button type="button" class="text-button" disabled>Настроить напоминание</button>'}
   ${rule?.enabled?'<button type="button" class="text-button" data-reminder-disable>Выключить</button>':''}</div><p data-reminder-error role="alert"></p><div data-reminder-devices></div>`;
  section.querySelector('[data-reminder-edit]')?.addEventListener('click',edit);
  section.querySelector('[data-reminder-disable]')?.addEventListener('click',async e=>{
   e.target.disabled=true;setBusy(true);
   try{await send({enabled:false});setDirty(false);render();toast('Напоминание выключено.')}
   catch(e){section.querySelector('[data-reminder-error]').textContent=e.message}
   finally{setBusy(false);if(e.target)e.target.disabled=false}
  });
  deviceInfo();
 }
 async function send(input){
  const result=await api(path,{method:'PUT',body:JSON.stringify({version:rule?.version??null,item_version:item.version,timezone_revision:plan.revision,...input})});
  rule=result.reminder;
 }
 function edit(){
  const savedOffset=rule?.offset_minutes??0,custom=!isPreset(savedOffset);
  const unit=savedOffset%1440===0?1440:savedOffset%60===0?60:1;
  section.innerHTML=`${heading()}<form class="planning-form reminder-form">${exact===null?
   `<label>Время отправки<input type="time" name="local_time" value="${esc(rule?.adjusted&&rule.scheduled?.day===day?rule.scheduled.time:rule?.local_time||'09:00')}" required></label><p class="muted">По местному времени ${item.date_end&&item.date_start&&item.date_end!==item.date_start?'первого дня периода':'этого дня'}.</p>`:
   `<label>Когда напомнить<select name="preset">${Object.entries(presets).map(([v,label])=>`<option value="${v}" ${Number(v)===savedOffset?'selected':''}>${label}</option>`).join('')}<option value="custom" ${custom?'selected':''}>Свой интервал</option></select></label>
    <div class="time-field-grid" data-offset-custom hidden><label>За сколько<input name="amount" type="number" min="1" max="43200" value="${custom?savedOffset/unit:15}"></label><label>Единица<select name="unit"><option value="1" ${unit===1?'selected':''}>минут</option><option value="60" ${unit===60?'selected':''}>часов</option><option value="1440" ${unit===1440?'selected':''}>дней</option></select></label></div>`}
   <p class="reminder-calculated muted" data-calculated aria-live="polite"></p><div data-reminder-devices></div>
   <p data-reminder-error role="alert"></p><div class="notification-actions"><button class="primary" type="submit">Сохранить напоминание</button><button class="text-button" type="button" data-reminder-back>Отмена</button></div></form>`;
  const form=section.querySelector('form'),fields=form.elements,button=form.querySelector('[type=submit]');
  function input(){return exact===null?{enabled:true,local_time:fields.local_time.value}:{enabled:true,offset_minutes:fields.preset.value==='custom'?Number(fields.amount.value)*Number(fields.unit.value):Number(fields.preset.value)}}
  function update(){
   const value=input(),output=form.querySelector('[data-calculated]');
   if(exact!==null){
    const visible=fields.preset.value==='custom',custom=form.querySelector('[data-offset-custom]');
    custom.hidden=!visible;fields.amount.required=visible;fields.amount.disabled=!visible;
    fields.amount.max=String(43200/Number(fields.unit.value));
    const valid=Number.isSafeInteger(value.offset_minutes)&&value.offset_minutes>=0&&value.offset_minutes<=43200&&(!visible||value.offset_minutes>0);
    const point=valid?localPoint(exact-value.offset_minutes*minute,plan):null;
    output.textContent=point?'Отправка: '+pointText(point)+(point.at<=Date.now()?' · время уже прошло.':''):'Интервал должен быть не больше 30 дней.';
    button.disabled=!point||point.at<=Date.now();
    return;
   }
   const choices=validClock(value.local_time)?tripLocalInstants(day,value.local_time,plan):[];
   const point=choices.length===1?localPoint(choices[0],plan):null;
   output.textContent=point?'Отправка: '+pointText(point)+(point.at<=Date.now()?' · время уже прошло.':''):
    validClock(value.local_time)?'При сохранении уточним, какой момент выбрать в связи с переходом пояса.':'Укажите время.';
   button.disabled=!validClock(value.local_time)||Boolean(point&&point.at<=Date.now());
  }
  form.oninput=()=>{setDirty(true);update()};
  form.querySelector('[data-reminder-back]').onclick=()=>{setDirty(false);render()};
  form.onsubmit=async e=>{
   e.preventDefault();if(button.disabled)return;const value=input();
   const out=section.querySelector('[data-reminder-error]');out.textContent='';
   setBusy(true);button.disabled=true;
   function done(){setDirty(false);render();toast(rule?.enabled?'Напоминание сохранено.':'Напоминание выключено.')}
   try{await send(value);done()}
   catch(e){
    if(e.details?.code==='reminder_time_check'){
     const {check,fingerprint,title}=e.details;
     review.show({mine:[{id:item.id,check,title}],plan,save:async(choices,back)=>{
      await send({...value,fingerprint,choice:choices[item.id]});back();done();
     }});
    }else out.textContent=e.message;
   }finally{setBusy(false);update()}
  };
  deviceInfo();update();form.querySelector('input,select')?.focus({preventScroll:true});
 }
 render();
 void api(path).then(result=>{rule=result.reminder},e=>{error=e.message}).finally(()=>{loading=false;render()});
 return {updateDevices:deviceInfo};
}
