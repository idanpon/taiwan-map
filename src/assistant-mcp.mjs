import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { toolDefinitions, executeAssistantTool, assistantInstructions } from './assistant-tools.mjs';
import { oauthActor, oauthChallenge } from './assistant-oauth.mjs';
import { Problem, fail, json } from './auth.mjs';

// These public assets contain no trip data. A content-addressed resource avoids
// rendering cached UI against a changed tool contract.
const asset=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
let bundledScript;
const widgetScript=()=>bundledScript??=(buildSync({entryPoints:[fileURLToPath(new URL('./assistant-widget.mjs',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',charset:'utf8',minify:true}).outputFiles[0].text.replace(/<\/script/gi,'<\\/script'));
const widgetCss=()=>asset('ui-tokens.css')+'\n'+asset('assistant.css');
export function widgetResource(){
  const script=widgetScript(),css=widgetCss(),version=createHash('sha256').update(script+css).digest('hex').slice(0,12);
  const uri=`ui://taiwan-map/proposal-${version}.html`;
  return {uri,mimeType:'text/html;profile=mcp-app',text:`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Изменения поездки</title><style>${css}</style><body class="assistant-body"><main id="assistant-card"><p role="status">Загрузка предложения…</p></main><script type="module">${script}</script></body></html>`,_meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}}}};
}
export async function handleMcp(request,env){
  try{oauthActor(request,env);}catch(e){if(e instanceof Problem)return json({error:e.message},e.status,{'WWW-Authenticate':oauthChallenge(env)});throw e;}
  // JSON-only, stateless transport: no long-lived connection keeps SQLite locks.
  if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});
  const server=new Server({name:'taiwan-map',version:'0.1.0'},{capabilities:{tools:{},resources:{}},instructions:assistantInstructions});
  const resource=widgetResource();
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:toolDefinitions.map(t=>{
    const securitySchemes=[{type:'oauth2',scopes:t.write?['trip:read','trip:write']:['trip:read']}];
    return {name:t.name,title:t.title,description:t.description,inputSchema:z.toJSONSchema(t.schema),securitySchemes,annotations:{readOnlyHint:!t.write,destructiveHint:t.name==='proposal_apply',idempotentHint:true,openWorldHint:false},_meta:{securitySchemes,ui:{visibility:['model','app'],...(t.ui?{resourceUri:resource.uri}:{})},'openai/widgetAccessible':true,...(t.ui?{'openai/outputTemplate':resource.uri}:{})}};
  })}));
  server.setRequestHandler(CallToolRequestSchema,async call=>{
    try{
      const def=toolDefinitions.find(t=>t.name===call.params.name);if(!def)fail(404,'Неизвестный инструмент.');
      const actor=oauthActor(request,env,def.write?'trip:write':'trip:read');
      const result=executeAssistantTool(env,actor,def.name,call.params.arguments||{});
      return {structuredContent:result,content:[{type:'text',text:JSON.stringify(result)}]};
    }catch(e){
      const status=e instanceof Problem?e.status:500;
      return {isError:true,content:[{type:'text',text:status===500?'Не удалось выполнить запрос. Проверьте результат операции перед повтором.':e.message}],structuredContent:{status,error:status===500?'Внутренняя ошибка.':e.message,retryable:status>=500},...(status===401?{_meta:{'mcp/www_authenticate':[oauthChallenge(env)]}}:{})};
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema,async()=>({resources:[{uri:resource.uri,name:'proposal',mimeType:resource.mimeType}]}));
  server.setRequestHandler(ReadResourceRequestSchema,async r=>{if(r.params.uri!==resource.uri)throw new Error('Resource not found');return {contents:[resource]};});
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  await server.connect(transport);
  try{const response=await transport.handleRequest(request);const bytes=await response.arrayBuffer();return new Response(bytes,{status:response.status,headers:response.headers});}
  finally{await server.close();}
}
