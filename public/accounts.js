import {installPasswordFields,enhancePasswordFields,confirmPassword,resetPasswordFields} from './password-fields.js';
const roleNames={admin:'Admin',editor:'Редактирование',viewer:'Просмотр'};
export function createAccountUI({api,$,esc,load,toast,getData,canOpen=()=>true}){
 installPasswordFields(document);
 let authConfig={mode:'shared',telegram_client_id:null},sdkPromise;
 const options=selected=>Object.entries(roleNames).map(([id,name])=>`<option value="${id}" ${id===selected?'selected':''}>${name}</option>`).join('');
 function error(message){$('account-error').textContent=message}
 function sdk(){
  if(!sdkPromise)sdkPromise=new Promise((resolve,reject)=>{
   if(window.Telegram?.Login){resolve();return}
   const script=document.createElement('script');script.src='https://oauth.telegram.org/js/telegram-login.js?6';script.onload=resolve;script.onerror=()=>{sdkPromise=null;reject(new Error('Не удалось загрузить вход Telegram. Попробуйте вход по логину.'))};document.head.append(script);
  });return sdkPromise;
 }
 async function prepareTelegram(button,purpose,target){
  button.hidden=!authConfig.telegram_client_id;if(button.hidden)return;button.disabled=true;
  try{
   await sdk();const {nonce}=await api('/api/auth/telegram/challenge',{method:'POST',body:JSON.stringify({purpose})});
   button.onclick=()=>{
    button.disabled=true;
    // Open synchronously in the click handler, with a nonce prepared in advance.
    window.Telegram.Login.auth({client_id:Number(authConfig.telegram_client_id),scope:['profile'],lang:'ru',nonce},async result=>{
     try{
      if(!result?.id_token)throw new Error('Вход через Telegram отменён.');
      await api('/api/auth/telegram/'+(purpose==='link'?'link':'login'),{method:'POST',body:JSON.stringify({nonce,id_token:result.id_token})});
      target.textContent='';await load();
      if(purpose==='link'){button.hidden=true;toast('Telegram привязан. Теперь можно входить двумя способами.');}
     }catch(e){target.textContent=e.message;await prepareTelegram(button,purpose,target)}
    });
    button.disabled=false;
   };button.disabled=false;
   clearTimeout(button.telegramTimer);button.telegramTimer=setTimeout(()=>{
    if((purpose==='login'&&!$('login').hidden)||(purpose==='link'&&$('accounts-dialog').open))prepareTelegram(button,purpose,target);
   },240000);
  }catch(e){target.textContent=e.message;button.disabled=false;button.onclick=()=>prepareTelegram(button,purpose,target)}
 }
 async function init(){
  authConfig=await api('/api/auth/config');
  $('username-field').hidden=authConfig.mode!=='accounts';$('username').required=authConfig.mode==='accounts';
  $('password-label').textContent=authConfig.mode==='accounts'?'Пароль':'Пароль к поездке';
  $('telegram-login').hidden=!authConfig.telegram_client_id;
 }
 function update(){
  const user=getData()?.user;if(!user)return;
  $('profile-name').textContent=user.name;
  $('accounts-open').textContent=user.can_setup?'Настроить аккаунты':user.role==='admin'?'Пользователи':'Профиль';
  $('manage-statuses').hidden=user.role==='viewer';
 }
 async function refreshUsers(){
  const result=await api('/api/admin/users');
  const actor=getData().user,activeAdmins=result.users.filter(u=>u.role==='admin'&&!u.disabled).length;
  $('account-users').innerHTML=result.users.map(u=>{
   const self=u.id===actor.id,lastAdmin=u.role==='admin'&&!u.disabled&&activeAdmins===1;
   return `<details class="account-user"><summary>${esc(u.name)} · ${roleNames[u.role]}${self?' · это вы':''}${u.disabled?' · доступ отключён':''}</summary><form data-user="${esc(u.id)}" data-name="${esc(u.name)}"><label>Имя<input name="name" value="${esc(u.name)}" maxlength="80" required></label><label>Логин<input name="username" value="${esc(u.username||'')}" minlength="3" maxlength="40" autocomplete="off" placeholder="${u.telegram_linked?'Необязательно для Telegram':'Логин'}"></label><p class="muted">Telegram: ${u.telegram_linked?'привязан':'не привязан'}</p><label>Права<select name="role">${options(u.role)}</select></label>${lastAdmin?'<p class="muted">Последний активный admin: понижение прав и отключение недоступны.</p>':''}<label>Новый пароль<input name="password" type="password" minlength="6" maxlength="256" autocomplete="new-password" placeholder="Оставьте пустым, чтобы сохранить"></label><label>Повторите новый пароль<input name="password_confirmation" type="password" minlength="6" maxlength="256" autocomplete="new-password" placeholder="Если меняете пароль"></label><label class="checkbox-label"><input name="disabled" type="checkbox" ${u.disabled?'checked':''} ${self||lastAdmin?'disabled':''}> Доступ отключён${self?' (свой аккаунт отключить нельзя)':''}</label><div class="account-actions"><button class="primary" type="submit">Сохранить</button><button class="danger-button" type="button" data-delete-user ${self||lastAdmin?'disabled':''}>Удалить аккаунт</button></div></form></details>`;
  }).join('');
  for(const form of $('account-users').querySelectorAll('form')){
   const user=result.users.find(u=>u.id===form.dataset.user);
   if(user.role==='admin'&&!user.disabled&&activeAdmins===1)for(const option of form.elements.role.options)option.disabled=option.value!=='admin';
  }
  enhancePasswordFields($('account-users'));
  $('telegram-requests').innerHTML=result.requests.length?'<h3>Заявки Telegram</h3>'+result.requests.map(u=>`<div class="telegram-request" data-request="${esc(u.subject)}"><strong>${esc(u.name)}</strong><select aria-label="Права нового участника">${options('viewer')}</select><button type="button" class="primary" data-approve>Одобрить</button><button type="button" class="text-button" data-reject>Отклонить</button></div>`).join(''):'<p class="muted">Новых заявок нет.</p>';
  $('telegram-requests').onclick=async event=>{
   const row=event.target.closest('[data-request]');if(!row||!event.target.closest('button'))return;
   event.target.disabled=true;error('');try{
    if(event.target.hasAttribute('data-approve'))await api('/api/admin/users',{method:'POST',body:JSON.stringify({telegram_request:row.dataset.request,name:row.querySelector('strong').textContent,role:row.querySelector('select').value})});
    else await api('/api/admin/telegram-requests/reject',{method:'POST',body:JSON.stringify({subject:row.dataset.request})});
    await refreshUsers();
   }catch(e){error(e.message);event.target.disabled=false}
  };
 }
 $('accounts-open').onclick=async()=>{
  const user=getData()?.user;if(!user||!canOpen())return;error('');$('accounts-dialog').showModal();
  $('account-title').textContent=user.can_setup?'Первый admin':user.role==='admin'?'Профиль и пользователи':'Мой профиль';
  resetPasswordFields($('change-password'));$('change-password').reset();
  $('own-profile').hidden=user.can_setup;$('own-profile').querySelector('h3').hidden=user.role!=='admin';
  $('current-password-field').hidden=!user.has_password;$('change-password').elements.current_password.required=user.has_password;
  $('own-username-field').hidden=Boolean(user.username);$('change-password').elements.username.required=!user.username;
  $('setup-account').hidden=!user.can_setup;$('admin-section').hidden=user.can_setup||user.role!=='admin';
  $('profile-description').textContent=user.can_setup?'Задайте личный логин и новый пароль. Нынешний общий пароль после настройки перестанет действовать.':`${user.name} · ${roleNames[user.role]}`;
  $('telegram-link').hidden=user.can_setup||user.telegram_linked||!authConfig.telegram_client_id;
  try{
   if(user.role==='admin'&&!user.can_setup)await refreshUsers();
   if(!$('telegram-link').hidden)await prepareTelegram($('telegram-link'),'link',$('account-error'));
  }catch(e){error(e.message)}
 };
 $('accounts-close').onclick=()=>$('accounts-dialog').close();
 $('users-refresh').onclick=()=>refreshUsers().catch(e=>error(e.message));
 $('setup-account').onsubmit=async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type=submit]');error('');if(!confirmPassword(form)){error('Пароли не совпадают.');return}button.disabled=true;
  try{
   await api('/api/auth/setup',{method:'POST',body:JSON.stringify({name:form.elements.name.value,username:form.elements.username.value,password:form.elements.password.value,password_confirmation:form.elements.password_confirmation.value,state_scope:'shared'})});
   form.reset();resetPasswordFields(form);$('accounts-dialog').close();await init();await load();toast('Учётная запись admin создана. Общий пароль больше не действует.');
  }catch(e){error(e.message)}finally{button.disabled=false}
 };
 $('create-account').onsubmit=async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type=submit]');error('');if(!confirmPassword(form)){error('Пароли не совпадают.');return}button.disabled=true;
  try{
   await api('/api/admin/users',{method:'POST',body:JSON.stringify({name:form.elements.name.value,username:form.elements.username.value,password:form.elements.password.value,password_confirmation:form.elements.password_confirmation.value,role:form.elements.role.value})});
   form.reset();resetPasswordFields(form);await refreshUsers();toast('Пользователь добавлен.');
  }catch(e){error(e.message)}finally{button.disabled=false}
 };
 $('change-password').onsubmit=async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type=submit]');error('');
  if(!confirmPassword(form)){error('Пароли не совпадают.');return}button.disabled=true;
  try{
   await api('/api/auth/password',{method:'POST',body:JSON.stringify({current_password:form.elements.current_password.value,username:form.elements.username.value,password:form.elements.password.value,password_confirmation:form.elements.password_confirmation.value})});
   resetPasswordFields(form);$('accounts-dialog').close();await load().catch(e=>{if(e.status!==401)throw e});toast('Пароль изменён. Войдите с новым паролем.');
  }catch(e){error(e.message)}finally{button.disabled=false}
 };
 $('account-users').oninput=event=>{
  const form=event.target.closest('form');if(form&&event.target.name==='password')form.elements.password_confirmation.required=Boolean(event.target.value);
 };
 $('account-users').onclick=async event=>{
  const button=event.target.closest('[data-delete-user]');if(!button)return;
  const form=button.closest('form');
  if(!window.confirm(`Удалить аккаунт «${form.dataset.name}»? Вход станет недоступен. Заметки и история карты сохранятся. Это действие нельзя отменить.`))return;
  button.disabled=true;error('');
  try{await api('/api/admin/users/'+form.dataset.user,{method:'DELETE'});await refreshUsers();toast('Аккаунт удалён.');}
  catch(e){error(e.message);button.disabled=false}
 };
 $('account-users').onsubmit=async event=>{
  event.preventDefault();const form=event.target,button=form.querySelector('button[type=submit]');error('');if(!confirmPassword(form)){error('Пароли не совпадают.');return}button.disabled=true;
  const payload={name:form.elements.name.value,role:form.elements.role.value,disabled:form.elements.disabled.checked};
  if(form.elements.username.value)payload.username=form.elements.username.value;
  if(form.elements.password.value){payload.password=form.elements.password.value;payload.password_confirmation=form.elements.password_confirmation.value;}
  try{
   const result=await api('/api/admin/users/'+form.dataset.user,{method:'PUT',body:JSON.stringify(payload)});
   resetPasswordFields(form);
   if(result.reauthenticate){$('accounts-dialog').close();await load().catch(e=>{if(e.status!==401)throw e});toast('Аккаунт обновлён. Войдите снова.');}
   else{await refreshUsers();toast('Доступ обновлён. Пользователю нужно войти заново.');}
  }catch(e){error(e.message)}finally{button.disabled=false}
 };
 return {init,update,resetLoginPassword:()=>resetPasswordFields($('login-form')),showLogin:()=>{resetPasswordFields(document);if(authConfig.telegram_client_id)prepareTelegram($('telegram-login'),'login',$('login-error'))}};
}
