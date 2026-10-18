import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../server/database.mjs';
import {importPlaces} from '../server/import-places.mjs';
import {hoursVerification,hoursOverview} from '../public/map-model.js';
function fixture(){
 const db=openDatabase();migrate(db,'drizzle');const s=db.sqlite;
 s.exec("INSERT INTO trips VALUES('taiwan-2026','Trip','Asia/Taipei'); INSERT INTO categories VALUES('sight','Достопримечательности','#bb623d','landmark',0); INSERT INTO categories VALUES('walks','Районы и прогулки','#527daa','footprints',1); INSERT INTO users(id,display_name,created_at) VALUES('trip-shared','Shared',1); INSERT INTO statuses(id,trip_id,label,color,sort_order,created_by) VALUES('visited','taiwan-2026','Наш статус','#123456',0,'trip-shared'); INSERT INTO places(id,trip_id,name,local_name,city,category_id,lat,lon,address,summary,tip,hours_json,verified_at,updated_at) VALUES('old','taiwan-2026','Existing','原名','Тайбэй','sight',25.03,121.52,'Address','Rich description','Existing tip','{}','2026-10-18',1); INSERT INTO place_links VALUES('old-link','old','Source','https://example.com','source'); INSERT INTO user_place_states VALUES('trip-shared','old','visited','Existing note',3,1); INSERT INTO state_events VALUES('event','trip-shared','old','visited','Existing note',3,1);");
 return db;
}
const row=(id,action='import')=>({id,import_action:action,name:'New place',local_name:'',city:'Тайбэй',category:'Районы и прогулки',note:'Source context',route_role:'Alternative',day_hint:'No date',transport:'Car',visit_status:'visited'});
const geo={reviewed:true,lat:25.04,lon:121.54,precision:'Здание, этаж указан отдельно',source_url:'https://example.com/location',address:'Verified address'};
const manifest=records=>({schema_version:1,source:'taiwan-trip-csv',records});
const table=(s,name)=>s.prepare('SELECT * FROM '+name+' ORDER BY rowid').all();
test('incremental import preserves existing content/states, maps IDs, keeps alternatives, and repeats without duplicates',()=>{
 const db=fixture(),s=db.sqlite,before={};for(const name of ['users','memberships','sessions','statuses','user_place_states','state_events'])before[name]=table(s,name);
 s.prepare("UPDATE places SET tags_json=?,tags_version=4 WHERE id='old'").run(JSON.stringify({photoSpot:true,reservation:{enabled:true,url:'https://example.com/book'}}));
 const old={...s.prepare("SELECT * FROM places WHERE id='old'").get()};
 const batch=manifest([{row:row('TW001'),geocoding:geo},{row:{...row('TW002'),name:'Other alternative'},geocoding:{...geo,lat:23.5}},{row:row('TW003'),existing_id:'old',category_change:{from:'sight',to:'walks'}},{row:row('TW004','review'),geocoding:geo},{row:row('TW005','separate'),geocoding:geo},{row:row('TW006'),pending_reason:'Unclear branch'}]);
 assert.deepEqual(importPlaces(s,batch).map(x=>x.result),['added','added','matched','review','separate','pending']);assert.equal(table(s,'places').length,1);assert.equal(table(s,'app_meta').length,0);
 importPlaces(s,batch,{apply:true,now:10});assert.equal(table(s,'places').length,3);
 assert.deepEqual({...s.prepare("SELECT * FROM places WHERE id='old'").get()},{...old,category_id:'walks',updated_at:10});
 for(const name in before)assert.deepEqual(table(s,name),before[name]);assert.equal(s.prepare("SELECT count(*) n FROM place_links WHERE place_id='old'").get().n,1);
 assert.equal(s.prepare("SELECT verified_at FROM places WHERE id='TW001'").get().verified_at,'');assert.equal(JSON.parse(s.prepare("SELECT hours_json FROM places WHERE id='TW001'").get().hours_json).label,'Не проверены');
 assert.deepEqual(importPlaces(s,batch,{apply:true}).map(x=>x.result),['unchanged','unchanged','unchanged','review','separate','pending']);assert.equal(table(s,'places').length,3);
 assert.throws(()=>importPlaces(s,manifest([{row:{...row('TW001'),name:'Changed'},geocoding:geo}]),{apply:true}),/Source record changed/);db.close();
});
test('import rejects duplicate IDs, category conflicts and wrong/unreviewed coordinates before any writes; transaction rolls back link errors',()=>{
 const db=fixture(),s=db.sqlite;
 for(const records of [[{row:row('TW001'),geocoding:geo},{row:row('TW001'),geocoding:geo}],[{row:row('TW001'),existing_id:'old'}],[{row:row('TW001'),geocoding:{...geo,lat:23.1,lon:113.2}}],[{row:row('TW001'),geocoding:{...geo,reviewed:false}}]]){
  assert.throws(()=>importPlaces(s,manifest(records),{apply:true}));assert.equal(table(s,'places').length,1);assert.equal(table(s,'app_meta').length,0);
 }
 assert.throws(()=>importPlaces(s,manifest([{row:row('TW001'),geocoding:geo},{row:row('TW002'),geocoding:{...geo,links:[{label:'Bad',url:'http://example.com'}]}}]),{apply:true}),/Invalid source link/);
 assert.equal(table(s,'places').length,1);assert.equal(table(s,'place_links').length,1);assert.equal(table(s,'app_meta').length,0);db.close();
});
test('unknown opening hours never acquire an invented verification date',()=>{
 for(const value of ['',null,'bad','2026-02-31'])assert.equal(hoursVerification(value),'Часы работы ещё не проверены.');
 assert.match(hoursVerification('2026-10-18'),/18.10.2026/);
 assert.equal(hoursOverview([{verified_at:'2026-10-18'},{verified_at:''}]),'Часы проверены у 1 из 2 мест');
 assert.match(hoursOverview([{verified_at:'2026-10-18'}]),/18.10.2026/);
});
