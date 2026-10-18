export const TRIP='taiwan-2026', SHARED_USER='trip-shared', TTL=14*86400;
const encoder=new TextEncoder();
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const unhex=s=>Uint8Array.from(s.match(/.{2}/g)||[],x=>parseInt(x,16));
export const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export const sha=async s=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(s)));
export async function passwordHash(password,salt=random().slice(0,32),iterations=600000) {
 const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 return `pbkdf2$${iterations}$${salt}$${hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unhex(salt),iterations},key,256))}`;
}
export async function verify(password,stored) {
 if(!/^pbkdf2\$(?:100000|600000)\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(stored||''))return false;
 const computed=await passwordHash(password,stored.split('$')[2],Number(stored.split('$')[1]));let diff=computed.length^stored.length;
 for(let i=0;i<computed.length;i++)diff|=computed.charCodeAt(i)^stored.charCodeAt(i);return diff===0;
}
export class Problem extends Error {constructor(status,message){super(message);this.status=status;}}
export const fail=(status,message)=>{throw new Problem(status,message)};
export function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}})}
export async function body(request,maxBytes=8192){
 if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'Нужен JSON.');
 if(Number(request.headers.get('content-length'))>maxBytes)fail(413,'Слишком большой запрос.');
 const reader=request.body?.getReader();let size=0,chunks=[];
 if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();fail(413,'Слишком большой запрос.')}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||Array.isArray(value)||typeof value!=='object')fail(400,'Нужен JSON-объект.');return value}catch{fail(400,'Некорректный JSON-объект.')}
}
export const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
export function sessionToken(request,env){
 if(env.AUTH_MODE==='bearer')return request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1]?.toLowerCase();
 return request.headers.get('cookie')?.match(/(?:^|;\s*)tw_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}
export async function session(request,db,env){
 const token=sessionToken(request,env);if(!token)return null;
 return stmt(db,'SELECT u.id,u.display_name,u.username,u.auth_subject,u.password_hash IS NOT NULL has_password,m.role FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=u.id AND m.trip_id=? WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0',TRIP,await sha(token),Date.now()).first();
}
export function cookie(token,secure,max=TTL,path='/'){return `tw_session=${token}; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=${max}${secure?'; Secure':''}`}
export async function issueSession(request,env,userId,{legacy=false,expectedPassword=null,expectedSubject=null}={}){
 const now=Date.now(),token=random();
 // Recheck credentials while inserting, so a concurrent password reset or
 // conversion from shared login cannot issue a session after revocation.
 const result=await env.DB.batch([stmt(env.DB,'DELETE FROM sessions WHERE expires_at<?',now),stmt(env.DB,`INSERT INTO sessions(token_hash,user_id,expires_at) SELECT ?,u.id,? FROM users u JOIN memberships m ON m.user_id=u.id AND m.trip_id=? WHERE u.id=? AND u.disabled=0 AND (?=0 OR (m.role='owner' AND NOT EXISTS (SELECT 1 FROM app_meta WHERE key='accounts_v1'))) AND (? IS NULL OR u.password_hash=?) AND (? IS NULL OR u.auth_subject=?)`,await sha(token),now+TTL*1000,TRIP,userId,Number(legacy),expectedPassword,expectedPassword,expectedSubject,expectedSubject)]);
 if(!result[1].meta.changes)fail(401,'Данные входа изменились. Войдите снова.');
 return env.AUTH_MODE==='bearer'?json({ok:true,token,expires_at:now+TTL*1000}):json({ok:true},200,{'Set-Cookie':cookie(token,new URL(request.url).protocol==='https:',TTL,env.SESSION_COOKIE_PATH||'/')});
}
// TRUST_PROXY=0 means all browsers may share one proxy IP. Keep a separate
// account bucket and enough IP headroom for a group signing in together.
export async function limitLogin(db,context,{account='',legacy=false,challenge=false}={}){
 const now=Date.now(),window=Math.floor(now/900000),ip=await sha(context.clientIp||'unknown');
 const buckets=[[`${challenge?'challenge':'login'}:ip:${ip}:${window}`,legacy?10:120],[`${challenge?'challenge':'login'}:global:${window}`,legacy?120:1000]];
 if(account)buckets.push([`account:${await sha(account)}:${window}`,10]);
 const results=await db.batch([stmt(db,'DELETE FROM login_attempts WHERE expires_at<?',now),...buckets.map(([bucket])=>stmt(db,'INSERT INTO login_attempts(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count',bucket,now+900000))]);
 if(buckets.some(([,max],i)=>results[i+1].results[0].count>max))fail(429,'Слишком много попыток. Подождите до 15 минут.');
}
