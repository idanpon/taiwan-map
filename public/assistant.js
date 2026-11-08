import { createApiClient } from './api-client.js';
import { readClientConfiguration, sessionStores } from './client-runtime.js';
import { mountAssistant, node } from './assistant-card.js';
const root=document.getElementById('assistant-card'),connectionsRoot=document.getElementById('assistant-connections');
const configuration=readClientConfiguration(window.TAIWAN_CONFIG),api=createApiClient({...configuration,...sessionStores(window)});
async function post(path,data){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);try{return await api(path,{method:'POST',body:JSON.stringify(data),signal:controller.signal});}finally{clearTimeout(timer);}}
const call=(name,args)=>post('/api/assistant/tool',{name,arguments:args});
const params=new URLSearchParams(location.search);
const button=(label,fn)=>{const b=node('button',label);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){const p=node('p',e.message,'assistant-error');p.setAttribute('role','alert');root.append(p);}finally{b.disabled=false;}};return b;};
async function showConnections(){
  const {connections}=await api('/api/assistant/connections');connectionsRoot.replaceChildren(node('h2','Подключения ChatGPT'));
  const active=connections.filter(c=>!c.revoked_at&&c.refresh_expires_at>Date.now());
  if(!active.length)connectionsRoot.append(node('p','Активных подключений пока нет.','assistant-muted'));
  for(const c of active){const row=node('div',undefined,'assistant-change');row.append(node('p',`Подключено ${new Date(c.created_at).toLocaleString('ru')}`),button('Отозвать доступ',async()=>{await post('/api/assistant/revoke',{id:c.id});await showConnections();}));connectionsRoot.append(row);}
}
async function load(){
  connectionsRoot.replaceChildren();
  if(configuration.configurationError)throw new Error(configuration.configurationError);
  if([...params.keys()].some(k=>params.getAll(k).length!==1))throw new Error('Ссылка содержит повторяющиеся параметры. Начните подключение заново.');
  if(params.has('client_id')){
    const input=Object.fromEntries(params),request=await post('/api/assistant/connection-request',input);
    root.replaceChildren(node('h2','Подключить ChatGPT к карте'),node('p',`Аккаунт карты: ${request.actor.display_name}`),node('p',request.scopes.includes('trip:write')&&request.actor.role!=='viewer'?'ChatGPT сможет читать поездку, готовить личные предложения и применять изменения после вашего подтверждения.':'ChatGPT сможет читать общую поездку. Изменения для этого аккаунта недоступны.'),node('p','Доступ включает скрытые места, план и заметки участников. Его можно отозвать на этой странице.','assistant-muted'));
    const accept=button('Разрешить подключение',async()=>{const result=await post('/api/assistant/consent',{...input,approved:true});location.assign(result.redirect);});accept.className='assistant-primary';const actions=node('div',undefined,'assistant-actions');actions.append(accept,button('Отказаться',async()=>{root.replaceChildren(node('p','Подключение отменено. Можно закрыть эту вкладку.'));history.replaceState(null,'',location.pathname);}));root.append(actions);
  }else if(params.has('proposal')){
    const ui=mountAssistant(root,call);ui.set(await call('proposal_read',{id:params.get('proposal')}));
  }else{
    const {proposals}=await call('proposal_list',{});root.replaceChildren(node('h2','Мои предложения'));
    if(!proposals.length)root.append(node('p','Предложений пока нет. Попросите ChatGPT подготовить изменение карты или плана.'));
    const list=node('ul',undefined,'assistant-list');for(const p of proposals){const row=node('li'),link=node('a',p.title);link.href='?proposal='+encodeURIComponent(p.id);row.append(link,node('p',({draft:'Черновик',ready:'Ждёт подтверждения',applied:'Сохранено',cancelled:'Отменено'})[p.status],'assistant-muted'));list.append(row);}root.append(list);
  }
  await showConnections();
}
async function start(){
  try{await load();}catch(e){
    root.replaceChildren(node('h2',e.status===401?'Войдите в аккаунт карты':'Не удалось открыть'),node('p',e.message,'assistant-error'));
    if(e.status===401){const link=node('a','Открыть карту и войти');link.href='./';link.target='_blank';link.rel='noopener';root.append(link,node('p','После входа вернитесь в эту вкладку. Пароль и ключи доступа не передаются в ChatGPT.','assistant-muted'));}
    root.append(button('Повторить',start));
  }
}
await start();
