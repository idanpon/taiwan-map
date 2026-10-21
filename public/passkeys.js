let library;
function browserLibrary(){
 if(!library)library=new Promise((resolve,reject)=>{
  if(window.SimpleWebAuthnBrowser){resolve(window.SimpleWebAuthnBrowser);return}
  const script=document.createElement('script');script.src=new URL('./vendor/simplewebauthn-browser-13.2.2.js',import.meta.url).href;
  script.onload=()=>resolve(window.SimpleWebAuthnBrowser);script.onerror=()=>{library=null;reject(new Error('Не удалось загрузить вход с ключом. Используйте пароль или Telegram.'))};document.head.append(script);
 });return library;
}
export function createPasskeyUI({api,$,esc,load,toast,reauthenticate}){
 let enabled=false,active=false;
 const supported=()=>window.isSecureContext&&Boolean(window.PublicKeyCredential)&&Boolean(navigator.credentials);
 function message(error){return error.name==='NotAllowedError'||error.code==='ERROR_CEREMONY_ABORTED'?'Вход с ключом отменён. Можно повторить или использовать пароль.':error.message}
 async function refresh(){
  const result=await api('/api/auth/passkeys');
  $('passkey-list').innerHTML=result.keys.length?result.keys.map(k=>`<div class="passkey-entry"><span>${esc(k.name)}<small>${k.last_used_at?'Последний вход: '+new Date(k.last_used_at).toLocaleDateString('ru'):'Добавлен: '+new Date(k.created_at).toLocaleDateString('ru')}</small></span><button class="text-button" type="button" data-remove-passkey="${esc(k.id)}">Удалить</button></div>`).join(''):'<p class="muted">Ключи пока не добавлены.</p>';
 }
 $('passkey-login').onclick=async()=>{
  if(active||!enabled)return;active=true;$('passkey-login').disabled=true;$('login-error').textContent='';
  try{
   const client=await browserLibrary(),request=await api('/api/auth/passkeys/login/options',{method:'POST',body:'{}'});
   const credential=await client.startAuthentication({optionsJSON:request.options});
   await api('/api/auth/passkeys/login/verify',{method:'POST',body:JSON.stringify({challenge_id:request.challenge_id,credential})});await load();
  }catch(error){$('login-error').textContent=message(error)}finally{active=false;$('passkey-login').disabled=false}
 };
 $('passkey-add').onclick=async()=>{
  if(active||!enabled)return;active=true;$('passkey-add').disabled=true;$('account-error').textContent='';
  try{
   const client=await browserLibrary(),request=await api('/api/auth/passkeys/register/options',{method:'POST',body:'{}'});
   const credential=await client.startRegistration({optionsJSON:request.options});
   await api('/api/auth/passkeys/register/verify',{method:'POST',body:JSON.stringify({challenge_id:request.challenge_id,credential,name:'Ключ доступа · '+new Date().toLocaleDateString('ru')})});await refresh();toast('Ключ добавлен. При следующем входе выберите «Войти с ключом доступа».');
  }catch(error){
   if(error.details?.code==='reauthenticate'){toast(error.message);$('accounts-dialog').close();reauthenticate()}
   else $('account-error').textContent=message(error);
  }finally{active=false;$('passkey-add').disabled=false}
 };
 $('passkey-list').onclick=async event=>{
  const button=event.target.closest('[data-remove-passkey]');if(!button||active||!window.confirm('Удалить этот ключ доступа? Вход по паролю и через Telegram сохранится.'))return;
  active=true;button.disabled=true;
  try{await api('/api/auth/passkeys/'+button.dataset.removePasskey,{method:'DELETE',body:'{}'});await refresh();toast('Ключ удалён.')}catch(error){$('account-error').textContent=error.message}finally{active=false;button.disabled=false}
 };
 return {configure(value){enabled=Boolean(value&&supported());$('passkey-login').hidden=!enabled;$('passkey-settings').hidden=!enabled},open:()=>enabled?refresh():Promise.resolve()};
}
