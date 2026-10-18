import test from 'node:test';import assert from 'node:assert/strict';import {openDatabase,migrate} from '../server/database.mjs';import {handle,passwordHash} from '../src/core.mjs';import {importExport} from '../server/import.mjs';
test('VPS import preserves current states and custom statuses and never overwrites a populated database',async()=>{
 const source=openDatabase(),target=openDatabase();migrate(source,'drizzle');migrate(target,'drizzle');const env={DB:source,APP_PASSWORD_HASH:await passwordHash('import-test-password')};let cookie='';
 const request=(path,method='GET',body)=>handle(new Request('https://api.example.com'+path,{method,headers:{Origin:'https://api.example.com',Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{clientIp:'import-test'});
 const login=await request('/api/login','POST',{password:'import-test-password'});cookie=login.headers.get('set-cookie').split(';')[0];
 const custom=await(await request('/api/statuses','POST',{label:'Забронировать',color:'#123456',symbol:'★',dimmed:true})).json();assert.ok(custom.id);
 assert.equal((await request('/api/statuses/'+custom.id,'PUT',{label:custom.label,color:custom.color,symbol:custom.symbol,version:custom.version})).status,200);
 assert.equal((await request('/api/places/chimei/state','PUT',{status_id:custom.id,note:'Проверить выставку',version:0})).status,200);
 const exported=await(await request('/api/export')).json();assert.deepEqual(importExport(target,exported),{places:10,statuses:4});
 const state=target.sqlite.prepare('SELECT * FROM user_place_states WHERE place_id=?').get('chimei');assert.equal(state.status_id,custom.id);assert.equal(state.note,'Проверить выставку');assert.equal(state.version,1);
 const savedStatus=target.sqlite.prepare('SELECT symbol,version,dimmed FROM statuses WHERE id=?').get(custom.id);assert.equal(savedStatus.symbol,'★');assert.equal(savedStatus.version,2);assert.equal(savedStatus.dimmed,1);
 assert.equal(target.sqlite.prepare('SELECT count(*) n FROM sessions').get().n,0);assert.throws(()=>importExport(target,exported),/not empty/);
 const bad=openDatabase();migrate(bad,'drizzle');const broken=structuredClone(exported);broken.places[0].lat=999;assert.throws(()=>importExport(bad,broken));assert.equal(bad.sqlite.prepare('SELECT count(*) n FROM places').get().n,0);assert.equal(bad.sqlite.prepare('SELECT count(*) n FROM users').get().n,0);
 source.close();target.close();bad.close();
});
