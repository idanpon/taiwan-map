import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient} from '../public/api-client.js';
const token='a'.repeat(64);
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
test('Pages client uses supplied storage and Authorization, restores after reload, and clears on logout or expiry',async()=>{
 const values=new Map(),calls=[];let denied=false;
 const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const fetchImpl=async(url,options)=>{calls.push({url,...options});if(denied)return response({error:'Expired'},401);return response(url.endsWith('/login')?{ok:true,token,expires_at:Date.now()+60000}:{ok:true})};
 const config={apiBase:'https://api.example.net',authMode:'bearer',storage,fetchImpl};
 let api=createApiClient(config);
 const login=await api('/api/login',{method:'POST',body:JSON.stringify({password:'test-password'})});assert.equal(login.token,undefined);assert.equal(values.size,1);
 assert.equal(calls[0].headers.get('authorization'),null);assert.equal(calls[0].credentials,'omit');assert.equal(calls[0].redirect,'error');
 api=createApiClient(config);await api('/api/data');assert.equal(calls.at(-1).headers.get('authorization'),'Bearer '+token);
 await api('/api/logout',{method:'POST'});assert.equal(values.size,0);await api('/api/data');assert.equal(calls.at(-1).headers.get('authorization'),null);
 await api('/api/login',{method:'POST',body:'{}'});denied=true;let notified=0;api=createApiClient({...config,onUnauthorized:()=>notified++});
 await assert.rejects(api('/api/data'),error=>error.status===401);assert.equal(notified,1);assert.equal(values.size,0);
 denied=false;await assert.rejects(api('https://untrusted.example/api/data'));await assert.rejects(api('//untrusted.example/api/data'));assert.ok(!JSON.stringify([...values]).includes('test-password'));
});
test('storage failures keep the token in memory; cookie mode remains compatible',async()=>{
 const broken={getItem(){throw Error()},setItem(){throw Error()},removeItem(){throw Error()}};const calls=[];
 const fetchImpl=async(url,options)=>{calls.push(options);return response(url.endsWith('/login')?{ok:true,token}:{ok:true})};
 const api=createApiClient({authMode:'bearer',storage:broken,fetchImpl});await api('/api/login',{method:'POST',body:'{}'});await api('/api/data');assert.equal(calls.at(-1).headers.get('authorization'),'Bearer '+token);
 const cookie=createApiClient({authMode:'cookie',storage:broken,fetchImpl});await cookie('/api/data');assert.equal(calls.at(-1).credentials,'include');assert.equal(calls.at(-1).headers.get('authorization'),null);
 const incompatible=createApiClient({authMode:'bearer',fetchImpl:async()=>response({ok:true})});await assert.rejects(incompatible('/api/login',{method:'POST',body:'{}'}),/режим авторизации/);
});
test('admin setup keeps its current authorization and exchanges the session; Telegram login stores only the app token',async()=>{
 const values=new Map(),calls=[];let issued='a'.repeat(64);
 const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const api=createApiClient({authMode:'bearer',storage,fetchImpl:async(path,options)=>{calls.push({path,...options});return response({ok:true,token:issued})}});
 await api('/api/login',{method:'POST',body:'{}'});issued='b'.repeat(64);
 const setup=await api('/api/auth/setup',{method:'POST',body:'{}'});assert.equal(calls.at(-1).headers.get('authorization'),'Bearer '+'a'.repeat(64));assert.equal(setup.token,undefined);
 await api('/api/data');assert.equal(calls.at(-1).headers.get('authorization'),'Bearer '+'b'.repeat(64));
 issued='c'.repeat(64);await api('/api/auth/telegram/login',{method:'POST',body:JSON.stringify({id_token:'telegram-id-token',nonce:'nonce'})});assert.equal(calls.at(-1).headers.get('authorization'),null);
 await api('/api/data');assert.equal(calls.at(-1).headers.get('authorization'),'Bearer '+'c'.repeat(64));assert.ok(!JSON.stringify([...values]).includes('telegram-id-token'));
});
test('persistent storage migrates a tab session, follows logout across tabs, and anonymous fallback does not open login',async()=>{
 const key='taiwan-map.session.v1:',persistent=new Map(),legacy=new Map([[key,token]]),calls=[];
 const wrap=m=>({getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)});
 let notified=0,deny=false;const api=createApiClient({authMode:'bearer',storage:wrap(persistent),legacyStorage:wrap(legacy),onUnauthorized:()=>notified++,fetchImpl:async(url,options)=>{calls.push(options);return response(deny?{error:'Expired'}:{ok:true},deny?401:200)}});
 assert.equal(api.hasSession(),true);assert.equal(persistent.get(key),token);assert.equal(legacy.size,0);await api('/api/data');assert.equal(calls.at(-1).headers.get('authorization'),'Bearer '+token);
 persistent.clear();assert.equal(api.hasSession(),false);await api('/api/data');assert.equal(calls.at(-1).headers.get('authorization'),null);
 deny=true;await assert.rejects(api('/api/data',{allowAnonymous:true}),e=>e.status===401);assert.equal(notified,0);assert.equal(calls.at(-1).allowAnonymous,undefined);
});
test('using sessionStorage as both fallback and legacy storage never deletes the active token',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},calls=[];
 const options={authMode:'bearer',storage,legacyStorage:storage,fetchImpl:async(path,config)=>{calls.push(config);return response(path==='/api/login'?{ok:true,token}:{ok:true})}};
 let api=createApiClient(options);await api('/api/login',{method:'POST',body:'{}'});assert.equal(values.size,1);assert.equal(api.hasSession(),true);await api('/api/data');assert.equal(calls.at(-1).headers.get('authorization'),'Bearer '+token);
 api=createApiClient(options);assert.equal(api.hasSession(),true);await api('/api/logout',{method:'POST'});assert.equal(values.size,0);
});
