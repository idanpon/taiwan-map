import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient} from '../public/api-client.js';
const token='a'.repeat(64);
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
test('Pages client uses tab storage and Authorization, restores after reload, and clears on logout or expiry',async()=>{
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
