import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {openDatabase,migrate} from '../server/database.mjs';
import {handle,passwordHash} from '../src/core.mjs';
import {cityOptions,statusAppearance,validStatusSymbol} from '../public/map-model.js';

async function fixture(){
 const DB=openDatabase();migrate(DB,'drizzle');
 const env={DB,AUTH_MODE:'bearer',APP_ORIGIN:'https://api.example',APP_PASSWORD_HASH:await passwordHash('fixture-shared')};
 const call=(path,method='GET',data,token='')=>handle(new Request(env.APP_ORIGIN+path,{method,headers:{Origin:env.APP_ORIGIN,...(token?{Authorization:'Bearer '+token}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),env,{clientIp:'status-tests'});
 const {token:legacy}=await(await call('/api/login','POST',{password:'fixture-shared'})).json();
 const {token:admin}=await(await call('/api/auth/setup','POST',{username:'admin',name:'Admin',password:'fixture-admin',password_confirmation:'fixture-admin',state_scope:'shared'},legacy)).json();
 const tokens={admin};
 for(const role of ['editor','viewer']){
  assert.equal((await call('/api/admin/users','POST',{username:role,name:role,role,password:'fixture-member',password_confirmation:'fixture-member'},admin)).status,201);
  tokens[role]=(await(await call('/api/login','POST',{username:role,password:'fixture-member'})).json()).token;
 }
 return {DB,call,...tokens};
}

test('city choices follow the catalog, count every place and handle many long city names',()=>{
 const places=[{city:'Тайбэй'},{city:'Тайбэй'},{city:'Тайнань'}];
 assert.deepEqual(cityOptions(places),[{name:'Тайбэй',count:2},{name:'Тайнань',count:1}]);
 const added=Array.from({length:30},(_,i)=>({city:'Новый город с длинным названием '+i}));
 const options=cityOptions([...places,...added]);assert.equal(options.length,32);
 assert.equal(options.find(c=>c.name===added[29].city).count,1);
 assert.deepEqual(cityOptions([]),[]);
});

test('status symbols allow one text character or blank, excluding emoji, whitespace, invisible and combined sequences',()=>{
 for(const symbol of ['', '!', '?', '+', '✓', '★', '←', '∑', '№', '€', '@', '&', '<', '>', 'é', '中', 'Я', '𝑥', '1', '#', '*'])assert.equal(validStatusSymbol(symbol),true,symbol);
 for(const symbol of [null,1,{},[], 'ab','!!',' ', '\n','\t','\u00a0','\u200b','\u200d','\u202e','\u0301','\ufe0e','\ufe0f','\u2800','\u3164','😀','🔥','❤','☀','🇹🇼','1️⃣','👨‍👩‍👧','👍🏻'])assert.equal(validStatusSymbol(symbol),false,JSON.stringify(symbol));
});

test('saved colors and symbols override no built-in names and use legible foreground colors',()=>{
 for(const id of ['want','maybe','visited','custom']){
  const value=statusAppearance({id,label:'Хайп!',color:'#00ff00',symbol:'+'});
  assert.equal(value.color,'#00ff00');assert.equal(value.symbol,'+');assert.equal(value.symbolColor,'#000000');
 }
 assert.equal(statusAppearance({color:'#000000',symbol:'!'}).symbolColor,'#ffffff');
 assert.equal(statusAppearance({color:'#ffffff',symbol:''}).textColor,'#354539');
 assert.equal(statusAppearance({color:'#123456',dimmed:true}).opacity,.7);
 assert.equal(statusAppearance({color:'#123456',dimmed:false}).opacity,1);
});

test('status migration preserves assignments and custom fields while persisting the previous displayed palette once',()=>{
 const DB=openDatabase();try{
  DB.sqlite.exec('CREATE TABLE _app_migrations(name TEXT PRIMARY KEY,hash TEXT NOT NULL,applied_at INTEGER NOT NULL)');
  for(const name of ['0000_absurd_penance.sql','0001_accounts.sql']){
   const sql=readFileSync('drizzle/'+name,'utf8');DB.sqlite.exec(sql);
   DB.sqlite.prepare('INSERT INTO _app_migrations VALUES(?,?,?)').run(name,createHash('sha256').update(sql).digest('hex'),1);
  }
  DB.sqlite.prepare('INSERT INTO trips VALUES(?,?,?)').run('taiwan-2026','Trip','Asia/Taipei');
  DB.sqlite.prepare('INSERT INTO users(id,display_name,created_at) VALUES(?,?,?)').run('trip-shared','Admin',1);
  for(const [id,label,color] of [['want','Хочу посетить','#b97639'],['visited','Уже посетил','#517c61'],['maybe','Под вопросом','#8c7ba0'],['hype','Хайп!','#0056d6'],['custom','Другой','#123456']])DB.sqlite.prepare('INSERT INTO statuses(id,trip_id,label,color,sort_order,created_by) VALUES(?,?,?,?,?,?)').run(id,'taiwan-2026',label,color,1,'trip-shared');
  migrate(DB,'drizzle');
  const get=id=>DB.sqlite.prepare('SELECT color,symbol,version FROM statuses WHERE id=?').get(id);
  assert.deepEqual({...get('want')},{color:'#1456e0',symbol:'!',version:1});
  assert.equal(get('visited').symbol,'✓');assert.equal(get('maybe').symbol,'?');assert.equal(get('hype').color,'#dc2626');
  assert.equal(get('custom').color,'#123456');assert.equal(get('custom').symbol,'');
  assert.equal(DB.sqlite.prepare('SELECT dimmed FROM statuses WHERE id=?').get('visited').dimmed,1);
  DB.sqlite.prepare('UPDATE statuses SET dimmed=0 WHERE id=?').run('visited');
  DB.sqlite.prepare('UPDATE statuses SET color=?,symbol=? WHERE id=?').run('#ffffff','+','want');
  migrate(DB,'drizzle');assert.equal(get('want').color,'#ffffff');assert.equal(get('want').symbol,'+');
  assert.equal(DB.sqlite.prepare('SELECT dimmed FROM statuses WHERE id=?').get('visited').dimmed,0);
 }finally{DB.close()}
});

test('admin and editor edit built-in and custom statuses without changing assignments, notes or place versions',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call('/api/places/taipei-101/state','PUT',{version:0,status_id:'want',note:'Preserve this note'},f.editor)).status,200);
  const initialEvents=f.DB.sqlite.prepare('SELECT * FROM state_events').all();
  const payload={label:'Новое название',color:'#00aa77',symbol:'★',dimmed:true,version:1};
  let r=await f.call('/api/statuses/want','PUT',payload,f.editor);assert.equal(r.status,200);assert.equal((await r.json()).version,2);
  r=await f.call('/api/statuses','POST',{label:'Созданный',color:'#112233',symbol:'<'},f.admin);assert.equal(r.status,201);const created=await r.json();assert.equal(created.symbol,'<');
  r=await f.call('/api/statuses/'+created.id,'PUT',{label:'Переименованный',color:'#ffffff',symbol:'',version:created.version},f.admin);assert.equal(r.status,200);
  const data=await(await f.call('/api/data','GET',undefined,f.viewer)).json(),status=data.statuses.find(s=>s.id==='want'),place=data.places.find(p=>p.id==='taipei-101');
  assert.equal(status.label,payload.label);assert.equal(status.symbol,'★');assert.equal(status.color,payload.color);assert.equal(status.dimmed,true);
  assert.equal(place.status_id,'want');assert.equal(place.note,'Preserve this note');assert.equal(place.version,1);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM state_events').all(),initialEvents);
  const exported=await(await f.call('/api/export','GET',undefined,f.admin)).json();assert.equal(exported.statuses.find(s=>s.id===created.id).symbol,'');
 }finally{f.DB.close()}
});

test('status API rejects emoji and malformed inputs and normalizes composed text symbols',async()=>{
 const f=await fixture();try{
  const payload={label:'Новый',color:'#112233',symbol:'+'};
  for(const invalid of [{symbol:'🔥'},{symbol:'1️⃣'},{symbol:'ab'},{symbol:'\u200b'},{symbol:1},{label:'  '},{label:'x'.repeat(41)},{color:'red;script'},{color:['#112233']},{dimmed:1},{dimmed:'true'},{dimmed:null}]){
   assert.equal((await f.call('/api/statuses','POST',{...payload,...invalid},f.editor)).status,400);
   assert.equal((await f.call('/api/statuses/want','PUT',{...payload,version:1,...invalid},f.editor)).status,400);
  }
  const response=await f.call('/api/statuses','POST',{...payload,symbol:'e\u0301'},f.editor);assert.equal(response.status,201);assert.equal((await response.json()).symbol,'é');
  assert.equal((await f.call('/api/statuses/want','PUT',{...payload,version:0},f.editor)).status,400);
  assert.equal((await f.call('/api/statuses/missing','PUT',{...payload,version:1},f.editor)).status,404);
  assert.equal((await f.call('/api/statuses/want','PUT',{...payload,version:1},f.viewer)).status,403);
  assert.equal((await f.call('/api/statuses','POST',payload,f.viewer)).status,403);
  assert.equal((await f.call('/api/statuses/want','PUT',{...payload,version:1})).status,401);
  f.DB.sqlite.prepare('UPDATE statuses SET archived=1 WHERE id=?').run('maybe');
  assert.equal((await f.call('/api/statuses/maybe','PUT',{...payload,version:1},f.editor)).status,404);
 }finally{f.DB.close()}
});

test('status edits reject duplicate names and concurrent stale versions',async()=>{
 const f=await fixture();try{
  const payload={label:'Обновлённый',color:'#112233',symbol:'?',version:1};
  const results=await Promise.all([f.call('/api/statuses/want','PUT',payload,f.editor),f.call('/api/statuses/want','PUT',{...payload,color:'#445566'},f.admin)]);
  assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
  assert.equal((await f.call('/api/statuses/maybe','PUT',payload,f.editor)).status,409);
  assert.equal((await f.call('/api/statuses','POST',payload,f.editor)).status,409);
  assert.equal(f.DB.sqlite.prepare('SELECT version FROM statuses WHERE id=?').get('want').version,2);
 }finally{f.DB.close()}
});


test('status transparency defaults, explicit toggles and older clients preserve the setting',async()=>{
 const f=await fixture();try{
  let data=await(await f.call('/api/data','GET',undefined,f.viewer)).json();
  assert.equal(data.statuses.find(s=>s.id==='visited').dimmed,true);
  assert.equal(data.statuses.find(s=>s.id==='want').dimmed,false);
  const payload={label:'Приглушённый',color:'#123456',symbol:'+'};
  let response=await f.call('/api/statuses','POST',payload,f.editor);assert.equal(response.status,201);
  let saved=await response.json();assert.equal(saved.dimmed,false);
  response=await f.call('/api/statuses/'+saved.id,'PUT',{...payload,version:saved.version,dimmed:true},f.editor);
  assert.equal(response.status,200);saved=await response.json();assert.equal(saved.dimmed,true);
  response=await f.call('/api/statuses/'+saved.id,'PUT',{...payload,version:saved.version},f.admin);
  assert.equal(response.status,200);saved=await response.json();assert.equal(saved.dimmed,true);
  assert.equal((await f.call('/api/statuses/'+saved.id,'PUT',{...payload,version:saved.version,dimmed:false},f.viewer)).status,403);
  response=await f.call('/api/statuses/'+saved.id,'PUT',{...payload,version:saved.version,dimmed:false},f.admin);
  assert.equal(response.status,200);saved=await response.json();assert.equal(saved.dimmed,false);
  data=await(await f.call('/api/data','GET',undefined,f.viewer)).json();assert.equal(data.statuses.find(s=>s.id===saved.id).dimmed,false);
 }finally{f.DB.close()}
});
