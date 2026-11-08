export const pushIcon='<svg class="notification-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"/></svg>';
const put=value=>({method:'PUT',body:JSON.stringify(value)});
const post=value=>({method:'POST',body:JSON.stringify(value)});
const safeStorage={
 get(key){try{return localStorage.getItem(key)}catch{return null}},
 set(key,value){try{localStorage.setItem(key,value)}catch{}},
 remove(key){try{localStorage.removeItem(key)}catch{}}
};
const supported=()=>isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
const appleMobile=()=>/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const installed=()=>navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;
const permission=()=>window.Notification?.permission||'default';
const installHelp='На iPhone и iPad откройте сайт в Safari, выберите «Поделиться» → «На экран Домой», затем откройте Тайвань с домашнего экрана.';
const defaultName=()=>appleMobile()?(navigator.userAgent.includes('iPhone')?'iPhone':'iPad'):/Android/.test(navigator.userAgent)?'Android':/Mac/.test(navigator.userAgent)?'Mac':/Windows/.test(navigator.userAgent)?'Windows':'Браузер';
const publicKeyBytes=key=>Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export function createNotificationUI({api,esc,getUser,toast,root,onChange=()=>{}}){
 let owner=null,settings=null,registration=null,registrationPromise=null,localSubscription=null,fetching=null,loadError='',busy=false,installation=null;
 let invite=null,invitationShown=false,invitationDismissed=false;
 const body=root.querySelector('[data-notification-settings]');
 const invitationKey=()=>owner?'taiwan-push-invitation:'+owner:null;
 function activateAccount(){
  const id=getUser()?.id||null;
  if(owner===id)return;
  owner=id;settings=null;fetching=null;loadError='';invitationShown=false;invitationDismissed=false;body.replaceChildren();
  if(!owner){root.open=false;root.hidden=true;if(invite)invite.hidden=true;return}
  installation=safeStorage.get('taiwan-push-installation:'+owner)||crypto.randomUUID();
  safeStorage.set('taiwan-push-installation:'+owner,installation);
  root.hidden=false;
 }
 const current=()=>settings?.devices.find(d=>d.installation_id===installation);
 const active=d=>d.enabled&&!d.expired;
 function status(){
  const d=current(),others=settings?.devices.filter(d=>d.installation_id!==installation&&active(d)).length||0;
  const connected=Boolean(d&&active(d)&&localSubscription&&permission()==='granted');
  let detail;
  if(appleMobile()&&!installed())detail=installHelp;
  else if(!supported())detail='Этот браузер не поддерживает пуши. Подключите другое устройство.';
  else if(permission()==='denied')detail='Пуши запрещены на этом устройстве. Разрешите уведомления в настройках устройства или браузера.';
  else if(!settings)detail=loadError||'Проверяем устройства…';
  else if(!settings.available)detail='Отправка пушей пока недоступна.';
  else if(connected)detail='Это устройство подключено.';
  else if(d?.expired)detail='Подписка этого устройства истекла. Подключите его заново.';
  else detail='Это устройство не подключено.';
  const paused=settings?.paused??false;
  const noDevices=Boolean(settings&&!connected&&!others);
  return {connected,others,paused,noDevices,detail,available:Boolean(settings?.available),
   canConnect:Boolean(settings?.available&&supported()&&(!appleMobile()||installed())&&permission()!=='denied'&&!connected)};
 }
 async function prepare(){
  if(!supported()||(appleMobile()&&!installed()))return null;
  if(!registrationPromise){
   registrationPromise=navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(async r=>{
    registration=r;
    localSubscription=await r.pushManager.getSubscription();
    return r;
   }).catch(error=>{registrationPromise=null;throw error});
  }
  return registrationPromise;
 }
 function changed(){render();renderInvitation();onChange(status())}
 async function refresh({fresh=false}={}){
  activateAccount();
  if(!owner)return null;
  if(settings&&!fresh)return settings;
  if(fetching)return fetching;
  const id=owner;
  fetching=(async()=>{
   try{
    const [result]=await Promise.all([api('/api/notifications'),prepare().catch(()=>null)]);
    if(id!==owner)return null;
    settings=result;loadError='';return result;
   }catch(error){
    if(id===owner)loadError=error.message;
    return null;
   }finally{if(id===owner){fetching=null;changed()}}
  })();
  return fetching;
 }
 function badge(d,s){
  if(d.expired)return 'Подписка истекла';
  if(!active(d))return 'Отключено';
  if(d.installation_id===installation)return s.connected?'Подключено':'Подключите заново';
  return 'Подключено · последнее известное состояние';
 }
 function render(){
  if(!owner||!root.open)return;
  const s=status();
  body.innerHTML=`<p class="muted">${esc(s.detail)}</p>${s.canConnect?'<button class="ui-button ui-button--primary" type="button" data-push-action="connect">Подключить это устройство</button>':''}
   ${settings?`<label class="checkbox-label notification-pause"><input data-push-pause type="checkbox" ${s.paused?'checked':''}> Приостановить пуши на всех моих устройствах</label>
   <p class="muted">Пауза и отключение устройства сохраняют ваши напоминания.</p>
   <h4>Мои устройства</h4>${settings.devices.length?settings.devices.map(d=>`<details class="notification-device"><summary><strong>${esc(d.name)}</strong>${d.installation_id===installation?' · это устройство':''}<small>${esc(badge(d,s))}</small></summary>
    <form data-device="${esc(d.id)}"><label>Имя устройства<input class="ui-field ui-field--soft" name="name" value="${esc(d.name)}" maxlength="60" required></label><div class="notification-actions"><button class="ui-button ui-button--quiet ui-button--compact" type="submit">Сохранить имя</button>
    ${active(d)?`<button class="ui-button ui-button--quiet ui-button--compact" type="button" data-push-action="test" ${s.paused||!s.available?'disabled':''}>Отправить тест</button><button class="ui-button ui-button--quiet ui-button--compact" type="button" data-push-action="disconnect">Отключить</button>`:''}</div>
    ${d.last_sent?`<p class="muted">Последняя передача push-сервису: ${esc(new Date(d.last_sent).toLocaleString('ru'))}</p>`:''}</form></details>`).join(''):'<p class="muted">Подключённых устройств пока нет.</p>'}`:'<button class="ui-button ui-button--quiet ui-button--compact" type="button" data-push-action="refresh">Проверить ещё раз</button>'}<p class="notification-feedback" role="status"></p>`;
 }
 function feedback(message){
  const el=body.querySelector('.notification-feedback');if(el)el.textContent=message;
 }
 async function perform(fn){
  if(busy)return;
  busy=true;feedback('');
  try{await fn()}catch(error){changed();feedback(error.message);toast(error.message)}
  finally{busy=false}
 }
 async function connect(){
  if(!status().canConnect)return;
  const id=owner;
  // Request OS permission directly from this click, never on calendar load.
  const allowed=permission()==='granted'?'granted':await Notification.requestPermission();
  if(allowed!=='granted'){changed();throw new Error('Разрешение на уведомления не получено. Его можно изменить в настройках.')}
  let r=await prepare();
  if(!r?.active){
   let timer;
   try{r=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Устройство ещё готовится. Попробуйте подключить его снова.')),8000)})])}
   finally{clearTimeout(timer)}
  }
  if(id!==owner)return;
  let sub=await r.pushManager.getSubscription();
  const key=publicKeyBytes(settings.public_key);
  if(sub?.options.applicationServerKey&&Array.from(new Uint8Array(sub.options.applicationServerKey)).join(',')!==Array.from(key).join(',')){
   await sub.unsubscribe();sub=null;
  }
  if(!sub)sub=await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  if(id!==owner){await sub.unsubscribe();return}
  const result=await api('/api/notifications/devices',post({installation_id:installation,name:current()?.name||defaultName(),subscription:sub.toJSON()}));
  if(id!==owner)return;
  settings=result;localSubscription=sub;safeStorage.set('taiwan-push-owner',owner);
  changed();toast('Это устройство подключено к пушам.');
 }
 function dismissInvitation(){
  invitationDismissed=true;
  if(invitationKey())safeStorage.set(invitationKey(),'seen');
  if(invite)invite.hidden=true;
 }
 function renderInvitation(){
  if(!invite)return;
  const s=status();
  const useful=s.available&&!s.connected&&permission()!=='denied'&&(s.canConnect||appleMobile()&&!installed());
  invite.hidden=!owner||!useful||invitationDismissed||!invitationShown&&Boolean(safeStorage.get(invitationKey()));
  if(invite.hidden)return;
  if(!invitationShown){invitationShown=true;safeStorage.set(invitationKey(),'seen')}
  invite.innerHTML=`<div>${pushIcon}<p><strong>Напоминания календаря</strong><br><span>${s.canConnect?'Можно получать личные напоминания на этом устройстве.':'На iPhone пуши доступны в приложении с домашнего экрана.'}</span></p></div><div class="notification-actions"><button type="button" class="ui-button ui-button--quiet ui-button--compact" data-push-invite="enable">${s.canConnect?'Включить пуши':'Как включить'}</button><button type="button" class="ui-button ui-button--quiet ui-button--compact" data-push-invite="dismiss">Не сейчас</button></div>`;
 }
 root.addEventListener('toggle',()=>{if(root.open){render();void refresh({fresh:true})}});
 root.addEventListener('click',event=>{
  const button=event.target.closest('[data-push-action]');
  if(!button)return;
  const id=button.closest('[data-device]')?.dataset.device;
  const path='/api/notifications/devices/'+id;
  void perform(async()=>{
   switch(button.dataset.pushAction){
    case 'connect':dismissInvitation();await connect();break;
    case 'refresh':await refresh({fresh:true});break;
    case 'disconnect':{
     const own=current()?.id===id;
     settings=await api(path,{method:'DELETE'});
     if(own){
      try{await localSubscription?.unsubscribe()}catch{}
      localSubscription=null;safeStorage.remove('taiwan-push-owner');
     }
     changed();toast('Устройство отключено. Напоминания сохранены.');break;
    }
    case 'test':
     await api(path+'/test',post({}));feedback('Тест принят push-сервисом. Проверьте уведомления на устройстве.');break;
   }
  });
 });
 root.addEventListener('change',event=>{
  if(!event.target.matches('[data-push-pause]'))return;
  void perform(async()=>{settings=await api('/api/notifications/preferences',put({paused:event.target.checked}));changed()});
 });
 root.addEventListener('submit',event=>{
  const form=event.target;if(!form.matches('[data-device]'))return;
  event.preventDefault();void perform(async()=>{settings=await api('/api/notifications/devices/'+form.dataset.device,put({name:form.elements.name.value}));changed();feedback('Имя устройства сохранено.')});
 });
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden||!owner||!settings)return;
  void (async()=>{
   if(registration)try{localSubscription=await registration.pushManager.getSubscription()}catch{localSubscription=null}
   if(root.open||invite)await refresh({fresh:true});else changed();
  })();
 });
 return {
  status,refresh,update:activateAccount,
  open(){root.open=true;root.scrollIntoView({block:'nearest'});root.querySelector('summary')?.focus()},
  calendar(container){
   if(invite===container)return;
   invite=container;
   invite.addEventListener('click',event=>{
    const action=event.target.closest('[data-push-invite]')?.dataset.pushInvite;if(!action)return;
    const s=status();dismissInvitation();
    if(action==='enable'&&s.canConnect)void perform(connect);
    else if(action==='enable'){document.getElementById('accounts-open')?.click();root.open=true;render()}
   });
  },
  async signOut(){
   if(safeStorage.get('taiwan-push-owner')!==owner)return;
   safeStorage.remove('taiwan-push-owner');
   try{const r=registration||await navigator.serviceWorker?.getRegistration('./');await (await r?.pushManager.getSubscription())?.unsubscribe()}catch{}
   localSubscription=null;
  }
 };
}
