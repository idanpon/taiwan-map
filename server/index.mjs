import http from 'node:http';
import {readFileSync,readdirSync,mkdirSync,unlinkSync,existsSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {handle} from '../src/core.mjs';
import {page,securityHeaders} from '../src/ui.mjs';
import {openDatabase,migrate} from './database.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(!process.env.APP_PASSWORD_HASH)throw new Error('APP_PASSWORD_HASH is required. Run node server/password.mjs.');
const origin=new URL(process.env.APP_ORIGIN||'http://localhost:8080');
if(!['http:','https:'].includes(origin.protocol))throw new Error('APP_ORIGIN must be http(s).');
const databasePath=resolve(process.env.DATABASE_PATH||'data/taiwan.sqlite');
const DB=openDatabase(databasePath);migrate(DB,resolve(root,'drizzle'));
const frontend=process.env.FRONTEND_ORIGIN?new URL(process.env.FRONTEND_ORIGIN):null;
if(frontend&&(frontend.origin!==process.env.FRONTEND_ORIGIN||frontend.protocol!=='https:'))throw new Error('FRONTEND_ORIGIN must be an exact HTTPS origin without a path.');
const cookiePath=process.env.SESSION_COOKIE_PATH||'/';
if(!/^\/[a-zA-Z0-9/_-]*$/.test(cookiePath))throw new Error('Invalid SESSION_COOKIE_PATH');
const authMode=process.env.AUTH_MODE||'cookie';
if(!['cookie','bearer'].includes(authMode))throw new Error('AUTH_MODE must be cookie or bearer');
const env={DB,APP_PASSWORD_HASH:process.env.APP_PASSWORD_HASH,APP_ORIGIN:origin.origin,FRONTEND_ORIGIN:frontend?.origin,SESSION_COOKIE_PATH:cookiePath,AUTH_MODE:authMode};
const mime={'.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,origin);let response;
  if(url.pathname.startsWith('/api/')){
   let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8192){res.writeHead(413,{'Content-Type':'application/json'});res.end('{"error":"Слишком большой запрос."}');return}chunks.push(chunk)}
   const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(','):v);
   const request=new Request(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
   const clientIp=process.env.TRUST_PROXY==='1'?headers.get('x-real-ip')||'unknown':req.socket.remoteAddress||'unknown';
   response=await handle(request,env,{clientIp});
   if(response.ok&&req.method==='POST'&&url.pathname==='/api/login'){try{backup()}catch(e){console.error('Backup failed',e.name)}}
  }else if(req.method!=='GET'&&req.method!=='HEAD'){response=new Response('Method not allowed',{status:405})}
  else if(url.pathname==='/'){response=new Response(page,{headers:securityHeaders})}
  else if(url.pathname==='/config.js'){response=new Response('window.TAIWAN_CONFIG = Object.freeze('+JSON.stringify({apiBase:'',requiresApi:false,authMode})+');',{headers:{'Content-Type':mime['.js'],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
  else{
   let path;try{path=resolve(root,'public','.'+decodeURIComponent(url.pathname))}catch{path=''}
   if(!path.startsWith(resolve(root,'public')+'/'))response=new Response('Not found',{status:404});
   else try{response=new Response(readFileSync(path),{headers:{'Content-Type':mime[extname(path)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=3600'}})}catch{response=new Response('Not found',{status:404})}
  }
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
 }catch(error){console.error('Request failed',error.name);res.writeHead(500);res.end('Internal server error')}
});
server.requestTimeout=20000;server.headersTimeout=15000;server.maxHeadersCount=50;
function backup(){if(!DB.sqlite.prepare('SELECT 1 FROM places LIMIT 1').get())return;const directory=resolve(dirname(databasePath),'backups');mkdirSync(directory,{recursive:true,mode:0o700});const day=new Date().toISOString().slice(0,10),target=resolve(directory,`taiwan-${day}.sqlite`);if(!existsSync(target))DB.sqlite.exec(`VACUUM INTO '${target.replaceAll("'","''")}'`);for(const file of readdirSync(directory).filter(x=>/^taiwan-\d{4}-\d{2}-\d{2}\.sqlite$/.test(x)).sort().reverse().slice(14))unlinkSync(resolve(directory,file))}
backup();const timer=setInterval(()=>{try{backup()}catch(e){console.error('Backup failed',e.name)}},6*3600000);timer.unref();
server.listen(Number(process.env.PORT||8080),process.env.HOST||'127.0.0.1',()=>console.log('Taiwan Map listening on port '+(process.env.PORT||8080)));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearInterval(timer);server.close(()=>{DB.close();process.exit(0)});setTimeout(()=>process.exit(1),10000).unref()});
