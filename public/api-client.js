// Session transport is independent from the map and its persisted trip data.
export function createApiClient({apiBase='',authMode='cookie',storage,fetchImpl=globalThis.fetch,onUnauthorized=()=>{}}={}){
 if(!['cookie','bearer'].includes(authMode))throw new Error('Некорректный режим авторизации.');
 const loginPaths=new Set(['/api/login','/api/auth/telegram/login','/api/auth/setup']);
 const key='taiwan-map.session.v1:'+apiBase;
 let token='';
 if(authMode==='bearer'){
  try{const saved=storage?.getItem(key);if(/^[a-f0-9]{64}$/.test(saved||''))token=saved;else storage?.removeItem(key)}catch{}
 }
 function setToken(value){token=value;try{if(value)storage?.setItem(key,value);else storage?.removeItem(key)}catch{}}
 return async function api(path,options={}){
  if(!/^\/api\/[a-zA-Z0-9/_-]+$/.test(path))throw new Error('Некорректный путь API.');
  if(['/api/login','/api/auth/telegram/login'].includes(path)&&authMode==='bearer')setToken('');
  const headers=new Headers(options.headers);
  if(options.body)headers.set('Content-Type','application/json');
  if(authMode==='bearer'&&token)headers.set('Authorization','Bearer '+token);
  const response=await fetchImpl(apiBase+path,{...options,headers,credentials:authMode==='bearer'?'omit':'include',redirect:'error',cache:'no-store'});
  let value;try{value=await response.json()}catch{throw new Error('Сервер вернул неожиданный ответ.')}
  if(!response.ok){
   if(response.status===401&&!loginPaths.has(path)){setToken('');onUnauthorized()}
   const error=new Error(value.error||'Не удалось выполнить запрос.');error.status=response.status;error.details=value.details;throw error;
  }
  if(authMode==='bearer'&&loginPaths.has(path)){
   if(!/^[a-f0-9]{64}$/.test(value.token||''))throw new Error('Сервер не поддерживает выбранный режим авторизации.');
   setToken(value.token);
   // The caller does not need access to the session credential.
   const {token:credential,...result}=value;return result;
  }
  if(path==='/api/logout')setToken('');
  return value;
 };
}
