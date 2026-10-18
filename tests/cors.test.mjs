import test from 'node:test';import assert from 'node:assert/strict';import {openDatabase,migrate} from '../server/database.mjs';import {handle,passwordHash} from '../src/core.mjs';
test('credentialed CORS permits only configured origins including error responses',async()=>{
 const DB=openDatabase();migrate(DB,'drizzle');const api='https://taiwan-api.example.com',frontend='https://taiwan.example.com';const env={DB,APP_ORIGIN:api,FRONTEND_ORIGIN:frontend,SESSION_COOKIE_PATH:'/taiwan/api',APP_PASSWORD_HASH:await passwordHash('cors-test-password')};
 const request=(path,method='GET',body,headers={})=>handle(new Request(api+path,{method,headers:{Origin:frontend,...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env,{clientIp:'cors-test'});
 let r=await request('/api/login','OPTIONS',undefined,{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'});assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),frontend);assert.equal(r.headers.get('access-control-allow-credentials'),'true');assert.equal(r.headers.get('vary'),'Origin');
 r=await request('/api/data');assert.equal(r.status,401);assert.equal(r.headers.get('access-control-allow-origin'),frontend);
 r=await request('/api/login','POST',{password:'wrong'});assert.equal(r.status,401);assert.equal(r.headers.get('access-control-allow-origin'),frontend);
 r=await request('/api/login','POST',{password:'cors-test-password'});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');assert.match(cookie,/Path=\/taiwan\/api;/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.ok(!cookie.includes('Domain='));
 r=await request('/api/data','GET',undefined,{Cookie:cookie.split(';')[0]});assert.equal(r.status,200);assert.equal((await r.json()).places.length,10);
 r=await request('/api/data','GET',undefined,{Origin:'https://untrusted.example'});assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);
 r=await request('/api/login','OPTIONS',undefined,{'Access-Control-Request-Method':'PATCH'});assert.equal(r.status,403);
 r=await request('/api/login','OPTIONS',undefined,{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization'});assert.equal(r.status,403);
 r=await request('/api/login','POST',null);assert.equal(r.status,400);
 r=await request('/api/login','POST',[]);assert.equal(r.status,400);
 DB.close();
});
