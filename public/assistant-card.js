// Shared by the authenticated site and the isolated MCP Apps card.
export function node(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
const statusLabels={draft:'Личный черновик',ready:'Ожидает подтверждения',applied:'Сохранено в поездку',cancelled:'Предложение отменено'};
const names={name:'Название',local_name:'Местное название',city:'Город',category_id:'Категория',lat:'Широта',lon:'Долгота',address:'Адрес',summary:'Описание',tip:'Совет',verified_at:'Проверено',coordinate_accuracy:'Точность точки',coordinate_source_url:'Источник координат',hours:'Часы работы',links:'Ссылки',hidden:'Скрыто с карты',status_id:'Статус места',note:'Заметка участников',tags:'Ярлыки',kind:'Тип',title:'Название',description:'Описание',state:'Состояние',priority:'Приоритет',assignee_id:'Ответственный',date_start:'Дата начала',date_end:'Дата окончания',starts_at:'Начало',ends_at:'Окончание',event_timezone:'Часовой пояс',fixed_external:'Фиксированный срок',source_urls:'Источники',options:'Варианты',places:'Связанные места',dependencies:'Зависит от',selected_option_id:'Выбранный вариант',resolved_at:'Решение принято',sort_order:'Порядок',label:'Название',url:'Ссылка',timezone:'Часовой пояс',weekly:'По дням недели',exceptions:'Исключения',always:'Круглосуточно',source_url:'Источник',intervals:'Время',day:'День недели',date:'Дата',photoSpot:'Место для фото',limitedDates:'Ограниченные даты',startDate:'С',endDate:'По',scheduleText:'Расписание',enabled:'Включено',reservation:'Бронирование',affects_visit:'Влияет на посещение',unselected_action:'Если не выбран',option_id:'Вариант',place_id:'Место',place_name:'Название места'};
const enumLabels={task:'Задача',visit:'Посещение',decision:'Решение',open:'Открыто',in_progress:'В работе',done:'Готово',cancelled:'Отменено',low:'Низкий',normal:'Обычный',high:'Высокий',critical:'Срочный',keep:'Оставить',hide:'Скрыть',official:'Официальный',source:'Источник',booking:'Бронирование',other:'Другое'};
function format(value,labels={},key=''){
  if(value===undefined||value===null||value==='')return '—';
  if(typeof value==='boolean')return value?'Да':'Нет';
  if(Array.isArray(value))return value.length?value.map(v=>format(v,labels,key)).join('; '):'—';
  if(key==='places'&&typeof value==='object')return [value.place_name||labels[value.place_id]||'Место',value.option_id?'вариант «'+(labels[value.option_id]||value.option_id)+'»':'',value.affects_visit?'влияет на посещение':'',value.unselected_action==='hide'?'скрыть, если не выбрано':'',value.deleted?'место удалено':''].filter(Boolean).join(' · ');
  if(key==='tags'&&typeof value==='object')return [value.photoSpot?'Место для фото':'',value.limitedDates?.enabled?format(value.limitedDates,labels):'',value.reservation?.enabled?'Бронирование: '+(value.reservation.url||'ссылка не указана'):''].filter(Boolean).join('; ')||'—';
  if(typeof value==='object')return Object.entries(value).filter(([k,v])=>!['id','item_id'].includes(k)&&v!==null&&v!==''&&(!Array.isArray(v)||v.length)).map(([k,v])=>`${names[k]||k}: ${format(v,labels,k)}`).join(' · ')||'—';
  if(key==='day')return ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][value];
  if(key==='resolved_at'&&typeof value==='number')return new Date(value).toLocaleString('ru');
  return labels[value]||enumLabels[value]||String(value);
}
export function unpack(result){
  const value=result.structuredContent||result;
  if(result.isError||value.error){const error=new Error(value.error||result.content?.find(c=>c.type==='text')?.text||'Не удалось выполнить действие.');error.status=value.status;throw error;}
  return value;
}
export async function applyWithRecovery(call,proposal){
  const args={id:proposal.id,version:proposal.version,confirmation_token:proposal.preview.confirmation_token,confirmed_via:'button'};
  for(let attempt=0;attempt<4;attempt++){
    try{return await call('proposal_apply',args);}catch(error){
      if(error.status&&error.status<500)throw error;
      let current;
      try{current=await call('proposal_read',{id:proposal.id});}catch(readError){if(readError.status&&readError.status<500)throw readError;}
      if(current?.status==='applied')return current.result;
      if(attempt===3){const unknown=new Error('Результат пока не подтверждён. Нажмите «Проверить результат» или вернитесь к предложению позже. Не создавайте повторный пакет.');unknown.unknown=true;throw unknown;}
      await new Promise(resolve=>setTimeout(resolve,300*2**attempt));
    }
  }
}
export function mountAssistant(root,call,{onApplied=()=>{},openLink}={}){
  let proposal=null,busy=false;
  const message=node('p','','assistant-message');message.setAttribute('role','status');
  const button=(text,fn,primary=false)=>{const b=node('button',text,primary?'assistant-primary':'');b.type='button';b.addEventListener('click',()=>action(fn));return b;};
  async function action(fn){if(busy)return;busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);message.textContent='Проверяем…';try{await fn();}catch(e){message.textContent=e.message+(e.status===409?' Обновите данные и подтвердите новый предпросмотр.':'');message.className='assistant-message assistant-error';}finally{busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}}
  function set(value){if(value.proposal_id&&value.status==='applied')proposal={...proposal,id:value.proposal_id,title:value.title||proposal?.title,status:'applied',preview:proposal?.preview||{labels:value.labels},result:value,review_url:value.review_url||proposal?.review_url};else proposal=value;render();}
  async function refresh(){set(await call('proposal_read',{id:proposal.id}));}
  function render(){
    root.replaceChildren();message.textContent='';message.className='assistant-message';
    if(!proposal?.id){root.append(node('p','Предложение ещё не подготовлено. Продолжите обсуждение в чате.'));return;}
    root.append(node('p',statusLabels[proposal.status]||proposal.status,'assistant-badge'),node('h2',proposal.title||'Изменения поездки'));
    const details=proposal.status==='applied'?proposal.result:proposal.preview;
    if(proposal.status==='applied')root.append(node('p','Сервер подтвердил сохранение. Повторное нажатие не создаст дубликатов.','assistant-success'));
    else root.append(node('p','Места видны публично, если не скрыты. План и заметки доступны только участникам поездки.','assistant-muted'));
    if(details?.changes){
      const labels=proposal.preview?.labels||{};
      if(proposal.preview?.reasons?.length){const reasons=node('ul');for(const reason of proposal.preview.reasons)reasons.append(node('li',reason.reason));root.append(reasons);}
      for(const change of details.changes){
        const item=node('article',undefined,'assistant-change');
        const noun=change.entity==='place'?'место':({task:'задачу',visit:'посещение',decision:'решение'})[change.after.kind]||'запись плана';
        item.append(node('h3',`${proposal.status==='applied'?'Сохранено':(change.action==='create'?'Добавить ':'Изменить ')+noun}: ${change.name}`));
        const list=node('dl'),extra=node('dl'),fold=node('details');
        const important=new Set(['hidden','status_id','selected_option_id','state','date_start','date_end','starts_at','ends_at','assignee_id','fixed_external','dependencies','places']);
        for(const key of change.fields){
          const after=format(change.after[key],labels,key),before=format(change.before?.[key],labels,key);
          if(change.action==='create'&&(after==='—'||['name','title','sort_order'].includes(key)||(after==='Нет'&&key!=='hidden')))continue;
          const target=important.has(key)?list:extra,dd=node('dd',change.action==='create'?after:`${before} → ${after}`);
          if(change.action==='create'&&/^https?:\/\//.test(after)&&!after.includes(' ')){const link=node('a',after);link.href=after;link.target='_blank';link.rel='noopener noreferrer';if(openLink)link.addEventListener('click',e=>{e.preventDefault();action(()=>openLink(after));});dd.replaceChildren(link);}
          target.append(node('dt',names[key]||key),dd);
        }
        if(list.childElementCount)item.append(list);
        if(extra.childElementCount){fold.append(node('summary','Сведения и источники: '+[...extra.querySelectorAll('dt')].map(e=>e.textContent.toLowerCase()).join(', ')),extra);item.append(fold);}
        root.append(item);
      }
      if(!details.changes.length)root.append(node('p','Новых изменений нет.'));
      const warnings=[...(details.warnings||[]),...(proposal.preview?.uncertainties||[])];
      if(warnings.length){const list=node('ul',undefined,'assistant-warning');for(const warning of warnings)list.append(node('li',typeof warning==='string'?warning:format(warning)));root.append(node('h3','Нужно учесть'),list);}
    }else if(proposal.operations){const list=node('ul');for(const op of proposal.operations)list.append(node('li',`${op.data?.name||op.data?.title||'Изменение записи'} — ${op.reason}`));root.append(list,node('p','Черновик сохранён лично для вас. На карту ничего не добавлено.'));}
    const actions=node('div',undefined,'assistant-actions');
    if(!['applied','cancelled'].includes(proposal.status)){
      if(proposal.status==='ready')actions.append(button('Подтвердить изменения',async()=>{const receipt=await applyWithRecovery(call,proposal);set(receipt);try{await onApplied(receipt);}catch{/* A chat notification is not the write receipt. */}},true));
      actions.append(button(proposal.status==='ready'?'Обновить предпросмотр':'Проверить и показать',async()=>set(await call('proposal_preview',{id:proposal.id,version:proposal.version})),proposal.status==='draft'));
      actions.append(button('Изменить',edit),button('Оставить черновиком',async()=>set(await call('proposal_draft',{id:proposal.id,version:proposal.version}))),button('Отменить предложение',async()=>set(await call('proposal_cancel',{id:proposal.id,version:proposal.version}))));
    }
    actions.append(button('Проверить результат',refresh));root.append(actions,message);
    if(proposal.review_url&&openLink){const link=button('Открыть на сайте',()=>openLink(proposal.review_url));root.append(link);}
  }
  async function edit(){
    const context=await call('trip_read',{}),input=structuredClone(proposal.input),form=node('form');
    const field=(parent,label,value,type='text')=>{const wrap=node('label',label),control=node('input');control.type=type;control.value=value??'';wrap.append(control);parent.append(wrap);return control;};
    const title=field(form,'Название предложения',input.title);title.maxLength=160;
    const edits=[];
    for(const op of input.operations){
      const box=node('fieldset'),legend=node('legend',op.data?.name||op.data?.title||op.reason);box.append(legend);
      const include=field(box,'Включить в пакет',null,'checkbox');include.checked=true;
      const update={op,include};
      if(op.data?.title!==undefined)update.title=field(box,'Название',op.data.title);
      if(op.kind.startsWith('plan.')){
        const current=context.planning.items.find(i=>i.id===op.id)||{};
        // Exact time editing needs a timezone-aware form in the calendar.
        if(!op.data.starts_at&&!current.starts_at){for(const k of ['date_start','date_end'])update[k]=field(box,names[k],op.data[k]??current[k],'date');}
        else box.append(node('p','Точное время и часовой пояс можно уточнить в чате.','assistant-muted'));
      }
      if(['place.create','place.visibility'].includes(op.kind)){update.hidden=field(box,'Скрыть место с публичной карты',null,'checkbox');update.hidden.checked=Boolean(op.hidden);}
      if(op.kind==='place.state'){
        const label=node('label','Статус места'),select=node('select'),p=context.places.find(p=>p.id===op.id);
        const none=node('option','Без статуса');none.value='';select.append(none);
        for(const s of context.statuses.filter(s=>!s.archived)){const option=node('option',s.label);option.value=s.id;select.append(option);}
        select.value=Object.hasOwn(op.data,'status_id')?op.data.status_id||'':p?.status_id||'';label.append(select);box.append(label);update.status=select;
      }
      box.append(node('p',op.reason,'assistant-muted'));form.append(box);edits.push(update);
    }
    const buttons=node('div',undefined,'assistant-actions');
    buttons.append(button('Сохранить и проверить',async()=>{
      const operations=edits.filter(e=>e.include.checked).map(e=>{const op=e.op;if(e.title)op.data.title=e.title.value;for(const k of ['date_start','date_end'])if(e[k])op.data[k]=e[k].value||null;if(e.hidden)op.hidden=e.hidden.checked;if(e.status)op.data.status_id=e.status.value||null;return op;});
      if(!operations.length)throw new Error('Оставьте хотя бы одно изменение или отмените предложение.');
      const saved=await call('proposal_save',{id:proposal.id,version:proposal.version,title:title.value,operations,uncertainties:input.uncertainties});
      set(saved);set(await call('proposal_preview',{id:saved.id,version:saved.version}));
    },true),button('Вернуться без изменений',async()=>render()));
    form.addEventListener('submit',e=>e.preventDefault());form.append(buttons,message);root.replaceChildren(node('h2','Уточнить предложение'),node('p','После правки потребуется новый предпросмотр и подтверждение. Зависимые записи должны оставаться в пакете.','assistant-muted'),form);
  }
  return {set};
}
