import test from 'node:test';import assert from 'node:assert/strict';import {openDatabase,migrate} from '../server/database.mjs';import {handle,passwordHash} from '../src/core.mjs';import {importExport} from '../server/import.mjs';
test('map-only import refuses to drop timezone changes and preserves exported trip dates',()=>{
 const db=openDatabase();migrate(db,'drizzle');
 const data={schema_version:1,trip:{id:'taiwan-2026',departure_date:'2035-01-01',start_date:'2035-01-02',end_date:'2035-01-10'},user:{id:'trip-shared'},categories:[],statuses:[],places:[]};
 try{
  assert.throws(()=>importExport(db,{...data,planning:{items:[],timezone_plan:{changes:[{at:1,zone:'Asia/Taipei'}]}}}),/calendar data/);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM trips').get().n,0);
  importExport(db,data);
  const trip=db.sqlite.prepare('SELECT departure_date,start_date,end_date FROM trips').get();
  for(const field of ['departure_date','start_date','end_date'])assert.equal(trip[field],data.trip[field]);
 }finally{db.close()}
});
test('VPS import preserves fixed assignments and archives unused definitions and never overwrites a populated database',async()=>{
 const source=openDatabase(),target=openDatabase();migrate(source,'drizzle');migrate(target,'drizzle');const env={DB:source,APP_PASSWORD_HASH:await passwordHash('import-test-password')};let cookie='';
 const request=(path,method='GET',body)=>handle(new Request('https://api.example.com'+path,{method,headers:{Origin:'https://api.example.com',Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{clientIp:'import-test'});
 const login=await request('/api/login','POST',{password:'import-test-password'});cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/api/places/chimei/state','PUT',{status_id:'want',note:'Проверить выставку',version:0})).status,200);
 const exported=await(await request('/api/export')).json();
 exported.statuses.push({id:'custom',label:'Забронировать',color:'#123456',symbol:'★',dimmed:true,version:2});
 const assigned=structuredClone(exported);assigned.places.find(p=>p.id==='chimei').status_id='custom';
 assert.throws(()=>importExport(target,assigned),/Resolve assigned custom statuses/);
 assert.deepEqual(importExport(target,exported),{places:10,statuses:4});
 const state=target.sqlite.prepare('SELECT * FROM user_place_states WHERE place_id=?').get('chimei');assert.equal(state.status_id,'want');assert.equal(state.note,'Проверить выставку');assert.equal(state.version,1);
 const savedStatus=target.sqlite.prepare("SELECT symbol,version,dimmed,archived FROM statuses WHERE id='custom'").get();assert.deepEqual({...savedStatus},{symbol:'★',version:2,dimmed:1,archived:1});
 assert.equal(target.sqlite.prepare('SELECT count(*) n FROM sessions').get().n,0);assert.throws(()=>importExport(target,exported),/not empty/);
 const bad=openDatabase();migrate(bad,'drizzle');const broken=structuredClone(exported);broken.places[0].lat=999;assert.throws(()=>importExport(bad,broken));assert.equal(bad.sqlite.prepare('SELECT count(*) n FROM places').get().n,0);assert.equal(bad.sqlite.prepare('SELECT count(*) n FROM users').get().n,0);
 source.close();target.close();bad.close();
});
