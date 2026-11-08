import { body, json, fail, Problem, session } from './auth.mjs';
import { handleMcp } from './assistant-mcp.mjs';
import { assistantConfig, oauthMetadata, oauthRequest, oauthConsent, oauthToken, oauthRevoke, permitted, listConnections, revokeConnection } from './assistant-oauth.mjs';
import { executeAssistantTool } from './assistant-tools.mjs';

export function assistantRoute(path){return path.startsWith('/api/assistant/')||path==='/.well-known/oauth-authorization-server'||path==='/.well-known/oauth-protected-resource'||path==='/.well-known/oauth-protected-resource/api/assistant/mcp';}
export async function handleAssistant(request,env,context={}){
  const url=new URL(request.url),path=url.pathname,origin=request.headers.get('origin');
  const browserOrigins=new Set([env.APP_ORIGIN,env.FRONTEND_ORIGIN].filter(Boolean));
  const mcpOrigin=origin&&['https://chatgpt.com','https://chat.openai.com'].includes(origin);
  const external=path==='/api/assistant/mcp'||path.startsWith('/api/assistant/oauth/')||path.startsWith('/.well-known/');
  let response;
  try{
    assistantConfig(env);
    if(origin&&!browserOrigins.has(origin)&&!(external&&mcpOrigin))fail(403,'Источник запроса не разрешён.');
    if(request.method==='OPTIONS'){
      if(!origin)fail(403,'Источник не указан.');
      const headers=(request.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
      if(headers.some(h=>!['authorization','content-type','mcp-protocol-version','mcp-session-id','accept'].includes(h)))fail(403,'Заголовок не разрешён.');
      response=new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, mcp-protocol-version, mcp-session-id, accept'}});
    }else if(path.startsWith('/.well-known/')&&request.method==='GET')response=json(oauthMetadata(env,path.includes('protected-resource')));
    else if(path==='/api/assistant/mcp')response=await handleMcp(request,env);
    else if(path==='/api/assistant/oauth/authorize'&&request.method==='GET'){
      if([...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1))fail(400,'Повторяющийся параметр.');
      oauthRequest(env,Object.fromEntries(url.searchParams));const ui=new URL(assistantConfig(env).ui);ui.search=url.search;response=new Response(null,{status:302,headers:{Location:ui.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
    }else if(path==='/api/assistant/oauth/token'&&request.method==='POST')response=await oauthToken(request,env,context);
    else if(path==='/api/assistant/oauth/revoke'&&request.method==='POST')response=await oauthRevoke(request,env);
    else{
      if(!['GET','POST'].includes(request.method))fail(405,'Метод не поддерживается.');
      if(request.method==='POST'&&!browserOrigins.has(origin))fail(403,'Для действия на сайте нужен разрешённый Origin.');
      const user=await session(request,env.DB,env);if(!user)fail(401,'Войдите на сайт карты.');
      const actor=permitted(env,user);
      if(path==='/api/assistant/consent'&&request.method==='POST')response=await oauthConsent(request,env);
      else if(path==='/api/assistant/connections'&&request.method==='GET')response=json(listConnections(env.DB,actor));
      else if(path==='/api/assistant/revoke'&&request.method==='POST'){const b=await body(request);if(typeof b.id!=='string')fail(400,'Укажите подключение.');response=json(revokeConnection(env.DB,actor,b.id));}
      else if(path==='/api/assistant/connection-request'&&request.method==='POST')response=json({...oauthRequest(env,await body(request)),actor});
      else if(path==='/api/assistant/tool'&&request.method==='POST'){
        const b=await body(request,131072);if(typeof b.name!=='string'||!b.arguments||typeof b.arguments!=='object')fail(400,'Некорректная операция.');
        response=json(executeAssistantTool(env,actor,b.name,b.arguments));
      }else fail(404,'Маршрут не найден.');
    }
  }catch(e){
    const status=e instanceof Problem?e.status:500;
    if(status===500)console.error('Assistant failure',e.name);
    const message=status===500?'Не удалось выполнить запрос. Проверьте результат перед повтором.':e.message;
    response=json(path==='/api/assistant/oauth/token'?{error:e.oauthCode||(status>=500?'server_error':'invalid_request'),error_description:message}:{error:message},status);
  }
  const headers=new Headers(response.headers);headers.set('Vary','Origin');headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');
  if(origin&&(browserOrigins.has(origin)||(external&&mcpOrigin))){headers.set('Access-Control-Allow-Origin',origin);headers.set('Access-Control-Expose-Headers','WWW-Authenticate, MCP-Protocol-Version');if(env.AUTH_MODE!=='bearer'&&browserOrigins.has(origin))headers.set('Access-Control-Allow-Credentials','true');}
  return new Response(response.body,{status:response.status,headers});
}
