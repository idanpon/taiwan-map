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
 for(const id of ['want','maybe','visited']){
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
  DB.sqlite.prepare('INSERT INTO trips(id,name,timezone) VALUES(?,?,?)').run('taiwan-2026','Trip','Asia/Taipei');
  DB.sqlite.prepare('INSERT INTO users(id,display_name,created_at) VALUES(?,?,?)').run('trip-shared','Admin',1);
  for(const [id,label,color] of [['want','Хочу посетить','#b97639'],['visited','Уже посетил','#517c61'],['maybe','Под вопросом','#8c7ba0'],['hype','Хайп!','#0056d6'],['custom','Другой','#123456']])DB.sqlite.prepare('INSERT INTO statuses(id,trip_id,label,color,sort_order,created_by) VALUES(?,?,?,?,?,?)').run(id,'taiwan-2026',label,color,1,'trip-shared');
  migrate(DB,'drizzle');
  const get=id=>DB.sqlite.prepare('SELECT color,symbol,version FROM statuses WHERE id=?').get(id);
  assert.deepEqual({...get('want')},{color:'#1456e0',symbol:'!',version:2});
  assert.equal(get('visited').symbol,'✓');assert.equal(get('maybe').symbol,'?');assert.equal(get('hype').color,'#dc2626');
  assert.equal(get('custom').color,'#123456');assert.equal(get('custom').symbol,'');
  assert.equal(DB.sqlite.prepare('SELECT dimmed FROM statuses WHERE id=?').get('visited').dimmed,1);
  DB.sqlite.prepare('UPDATE statuses SET dimmed=0 WHERE id=?').run('visited');
  DB.sqlite.prepare('UPDATE statuses SET color=?,symbol=? WHERE id=?').run('#ffffff','+','want');
  migrate(DB,'drizzle');assert.equal(get('want').color,'#ffffff');assert.equal(get('want').symbol,'+');
  assert.equal(DB.sqlite.prepare('SELECT dimmed FROM statuses WHERE id=?').get('visited').dimmed,0);
 }finally{DB.close()}
});

test('catalog exposes fixed definitions and place state accepts exactly those IDs and null',async t=>{
 const f=await fixture();t.after(()=>f.DB.close());
 const get=async(path,token)=>(await f.call(path,'GET',undefined,token)).json();
 const data=await get('/api/data',f.viewer), publicData=await get('/api/public/data');
 const expected=['maybe','visited','want'];
 for(const catalog of [data,publicData,await get('/api/export',f.admin)])
  assert.deepEqual(catalog.statuses.map(status=>status.id).sort(),expected);
 assert.equal(data.statuses.find(status=>status.id==='visited').dimmed,true);
 const place=data.places.find(p=>p.id==='taipei-101');
 let version=place.version;
 for(const status_id of [...expected,null]){
  const result=await f.call('/api/places/taipei-101/state','PUT',{version,status_id,note:'Shared note'},f.editor);
  assert.equal(result.status,200);
  version=(await result.json()).version;
  const saved=(await get('/api/data',f.viewer)).places.find(p=>p.id===place.id);
  assert.equal(saved.status_id,status_id);assert.equal(saved.note,'Shared note');
 }
 f.DB.sqlite.prepare("INSERT INTO statuses(id,trip_id,label,color,sort_order,archived) VALUES('legacy','taiwan-2026','Legacy','#123456',10,1)").run();
 assert.equal((await f.call('/api/places/taipei-101/state','PUT',{version,status_id:'legacy',note:'Invalid'},f.editor)).status,400);
 for(const [path,method] of [['/api/statuses','POST'],['/api/statuses/want','PUT'],['/api/statuses/legacy','DELETE']]){
  assert.equal((await f.call(path,method,{},f.editor)).status,405);
  assert.equal((await f.call(path,method,{},f.viewer)).status,403);
 }
 assert.equal((await f.call('/api/statuses','POST',{})).status,401);
});
