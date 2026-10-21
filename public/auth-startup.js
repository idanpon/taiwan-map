// Do not expose a login mode until config and the existing session are checked.
export function createAuthStartup({initialize,load,onLoading,onLogin,onError,timeoutMs=15000,timers=globalThis}){
 let pending=null;
 return {
  get running(){return Boolean(pending)},
  run(){
   if(pending)return pending;
   onLoading();const controller=new AbortController();
   const timer=timers.setTimeout(()=>controller.abort(),timeoutMs);
   pending=Promise.resolve().then(async()=>{
    let configured=false;
    try{await initialize(controller.signal);configured=true;await load(controller.signal)}
    catch(error){if(configured&&error.status===401)onLogin();else onError(controller.signal.aborted?'Сервер не ответил вовремя. Проверьте подключение и повторите.':error.message||'Не удалось загрузить карту.')}
    finally{timers.clearTimeout(timer);pending=null}
   });return pending;
  }
 };
}

// The initial HTML already shows this screen, before modules or API requests finish.
export function createLoadingScreenUI({$,message}){
 return {
  show(){
   $('login').hidden=false;$('auth-content').hidden=true;$('auth-loading').hidden=false;
   $('auth-loading').dataset.state='loading';$('auth-loading-message').textContent=message;$('auth-retry').hidden=true;
  },
  error(message){
   $('auth-loading').dataset.state='error';$('auth-loading-message').textContent=message;$('auth-retry').hidden=false;
  }
 };
}
