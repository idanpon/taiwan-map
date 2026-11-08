import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fail, json, body, session, limitLogin, Problem } from './auth.mjs';
import { one, all, run, transaction } from './sqlite.mjs';
import { assertActor } from './assistant-changes.mjs';

const digest=s=>createHash('sha256').update(s).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const scopes=['trip:read','trip:write'];
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const oauthFail=(code,message)=>{const e=new Problem(400,message);e.oauthCode=code;throw e;};
export function assistantConfig(env){
  if(env.ASSISTANT_ENABLED!=='1')fail(404,'Плагин пока не подключён.');
  const origin=env.APP_ORIGIN,base=new URL(origin);
  if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname))fail(503,'Для плагина нужен HTTPS.');
  let redirects,users;try{redirects=JSON.parse(env.ASSISTANT_REDIRECT_URIS||'[]');users=JSON.parse(env.ASSISTANT_USER_IDS||'[]');}catch{fail(503,'Проверьте настройки плагина.');}
  // Empty allowlists expose discovery only and deny all authorization. This
  // lets the owner obtain the exact callback during initial ChatGPT setup.
  if(!Array.isArray(redirects)||redirects.some(s=>{try{const u=new URL(s);return u.protocol!=='https:'||u.hash||u.username||u.password;}catch{return true;}})||!Array.isArray(users)||users.some(s=>typeof s!=='string'))fail(503,'Проверьте разрешённые подключения плагина.');
  const ui=new URL(env.ASSISTANT_UI_URL||'/assistant.html',origin);
  if(ui.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(ui.hostname))fail(503,'Для страницы подключения нужен HTTPS.');
  if(ui.search||ui.hash||ui.username||ui.password)fail(503,'Некорректная страница подключения.');
  return {origin,resource:origin+'/api/assistant/mcp',ui:ui.href,clientId:env.ASSISTANT_CLIENT_ID||'taiwan-chatgpt',redirects,users};
}
export function permitted(env,user){
  const cfg=assistantConfig(env),actor=assertActor(env.DB,user);
  if(!cfg.users.includes(actor.id))fail(403,'Для этого аккаунта подключение плагина не разрешено.');
  return actor;
}
export function oauthChallenge(env,scope='trip:read'){
  return `Bearer resource_metadata="${assistantConfig(env).origin}/.well-known/oauth-protected-resource/api/assistant/mcp", scope="${scope}"`;
}
export function oauthActor(request,env,scope='trip:read'){
  const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if(!token)fail(401,'Подключите аккаунт карты.');
  const cfg=assistantConfig(env),grant=one(env.DB,'SELECT * FROM assistant_oauth_grants WHERE access_hash=? AND resource=? AND revoked_at IS NULL AND access_expires_at>?',digest(token),cfg.resource,Date.now());
  if(!grant)fail(401,'Подключение истекло или отозвано. Войдите снова.');
  const actor=permitted(env,{id:grant.user_id});
  if(!grant.scope.split(' ').includes(scope))fail(403,'Подключению не разрешено это действие.');
  return actor;
}
function authorizeParams(env,input){
  const cfg=assistantConfig(env);
  if(input.client_id!==cfg.clientId||!cfg.redirects.includes(input.redirect_uri))fail(400,'Неизвестный клиент или адрес возврата.');
  if(input.response_type!=='code'||input.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(input.code_challenge||''))fail(400,'Нужен authorization code с PKCE S256.');
  if(input.resource!==cfg.resource)fail(400,'Неверное назначение токена.');
  if(typeof input.state!=='string'||!input.state||input.state.length>1024)fail(400,'Некорректное состояние подключения.');
  if(input.scope!==undefined&&typeof input.scope!=='string')fail(400,'Некорректный список разрешений.');
  const requested=[...new Set((input.scope||'trip:read').split(' '))];
  if(!requested.includes('trip:read')||requested.some(s=>!scopes.includes(s)))fail(400,'Неизвестные разрешения.');
  return {cfg,requested};
}
export function oauthRequest(env,params){const {requested}=authorizeParams(env,params);return {client:'ChatGPT · Taiwan Map',scopes:requested};}
export async function oauthConsent(request,env){
  const user=await session(request,env.DB,env);if(!user)fail(401,'Войдите на сайт карты.');
  const actor=permitted(env,user),b=await body(request),{cfg,requested}=authorizeParams(env,b);
  if(b.approved!==true)fail(400,'Подтвердите подключение.');
  const scope=requested.filter(s=>s!=='trip:write'||['owner','admin','editor'].includes(actor.role)).join(' ');
  const code=secret();
  transaction(env.DB,()=>{
    run(env.DB,'DELETE FROM assistant_oauth_codes WHERE expires_at<?',Date.now());
    run(env.DB,'INSERT INTO assistant_oauth_codes VALUES(?,?,?,?,?,?,?,?)',digest(code),actor.id,cfg.clientId,b.redirect_uri,cfg.resource,b.code_challenge,scope,Date.now()+300000);
  });
  const redirect=new URL(b.redirect_uri);redirect.searchParams.set('code',code);redirect.searchParams.set('state',b.state);redirect.searchParams.set('iss',cfg.origin);
  return json({redirect:redirect.href});
}
async function form(request){
  if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))fail(415,'Нужна URL-encoded форма.');
  const text=await request.text();if(Buffer.byteLength(text)>8192)fail(413,'Слишком большой запрос.');
  const params=new URLSearchParams(text);if([...params.keys()].some(k=>params.getAll(k).length!==1))fail(400,'Повторяющийся параметр.');return Object.fromEntries(params);
}
export async function oauthToken(request,env,context){
  await limitLogin(env.DB,context,{challenge:true});
  const cfg=assistantConfig(env),b=await form(request);
  if(b.client_id!==cfg.clientId)oauthFail('invalid_client','Неизвестный клиент.');
  if(b.resource!==cfg.resource)oauthFail('invalid_target','Неверное назначение токена.');
  const now=Date.now(),access=secret(),refresh=secret();
  return transaction(env.DB,()=>{
    let grant;
    if(b.grant_type==='authorization_code'){
      const code=typeof b.code==='string'?one(env.DB,'SELECT * FROM assistant_oauth_codes WHERE code_hash=?',digest(b.code)):null;
      if(!code||code.expires_at<=now||code.client_id!==b.client_id||code.redirect_uri!==b.redirect_uri||code.resource!==b.resource||!/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier||'')||!same(createHash('sha256').update(b.code_verifier).digest('base64url'),code.challenge))oauthFail('invalid_grant','Код подключения недействителен. Повторите вход.');
      permitted(env,{id:code.user_id});
      run(env.DB,'DELETE FROM assistant_oauth_codes WHERE code_hash=?',digest(b.code));
      grant={id:crypto.randomUUID(),user_id:code.user_id,scope:code.scope};
      run(env.DB,'INSERT INTO assistant_oauth_grants(id,user_id,client_id,resource,scope,access_hash,refresh_hash,access_expires_at,refresh_expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',grant.id,grant.user_id,cfg.clientId,cfg.resource,grant.scope,digest(access),digest(refresh),now+3600000,now+30*86400000,now);
    }else if(b.grant_type==='refresh_token'){
      grant=typeof b.refresh_token==='string'?one(env.DB,'SELECT * FROM assistant_oauth_grants WHERE refresh_hash=? AND client_id=? AND resource=? AND revoked_at IS NULL AND refresh_expires_at>?',digest(b.refresh_token),cfg.clientId,cfg.resource,now):null;
      if(!grant)oauthFail('invalid_grant','Подключение истекло или отозвано.');
      const actor=permitted(env,{id:grant.user_id});
      if(!['owner','admin','editor'].includes(actor.role))grant.scope='trip:read';
      run(env.DB,'UPDATE assistant_oauth_grants SET scope=?,access_hash=?,refresh_hash=?,access_expires_at=? WHERE id=?',grant.scope,digest(access),digest(refresh),now+3600000,grant.id);
    }else oauthFail('unsupported_grant_type','Неподдерживаемый способ получения токена.');
    return json({access_token:access,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope:grant.scope});
  });
}
export async function oauthRevoke(request,env){
  const cfg=assistantConfig(env),b=await form(request);
  if(b.client_id!==cfg.clientId||typeof b.token!=='string')fail(400,'Некорректный запрос отзыва.');
  run(env.DB,'UPDATE assistant_oauth_grants SET revoked_at=? WHERE client_id=? AND (access_hash=? OR refresh_hash=?)',Date.now(),cfg.clientId,digest(b.token),digest(b.token));
  return json({});
}
export function listConnections(db,user){return {connections:all(db,'SELECT id,client_id,scope,created_at,refresh_expires_at,revoked_at FROM assistant_oauth_grants WHERE user_id=? ORDER BY created_at DESC LIMIT 100',user.id)};}
export function revokeConnection(db,user,id){run(db,'UPDATE assistant_oauth_grants SET revoked_at=? WHERE id=? AND user_id=?',Date.now(),id,user.id);return {ok:true};}
export function oauthMetadata(env,resource=false){
  const c=assistantConfig(env);
  return resource?{resource:c.resource,authorization_servers:[c.origin],scopes_supported:scopes,bearer_methods_supported:['header'],resource_name:'Taiwan Map'}:{issuer:c.origin,authorization_endpoint:c.origin+'/api/assistant/oauth/authorize',token_endpoint:c.origin+'/api/assistant/oauth/token',revocation_endpoint:c.origin+'/api/assistant/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:scopes,authorization_response_iss_parameter_supported:true};
}
