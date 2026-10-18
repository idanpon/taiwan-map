import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase,migrate} from '../server/database.mjs';
import {handle,passwordHash} from '../src/core.mjs';
import {importExport} from '../server/import.mjs';
import {categoryDefinitions,categoryIcon,categoryId} from '../public/categories.js';
import {helpContent} from '../public/help.js';

const legacyCategories=[['sight','Достопримечательности','#bb623d','landmark'],['culture','Искусство и музеи','#786b9d','museum'],['cafe','Кофе','#92704b','coffee'],['food','Еда','#c38331','utensils'],['shopping','Шопинг','#4d8586','bag'],['nature','Природа','#65855d','leaf']];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function fixture(DB){
 const env={DB,APP_ORIGIN:'https://api.example',APP_PASSWORD_HASH:await passwordHash('category-fixture')};let cookie='';
 const call=(path,method='GET',data)=>handle(new Request(env.APP_ORIGIN+path,{method,headers:{Origin:env.APP_ORIGIN,Cookie:cookie,...(data!==undefined?{'Content-Type':'application/json'}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),env,{clientIp:'category-fixture'});
 const login=await call('/api/login','POST',{password:'category-fixture'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('/api/places/simple-kaffa/state','PUT',{version:0,status_id:'want',note:'Preserve café note'})).status,200);
 return call;
}

test('ten shared category definitions use the requested outline icons and normalize old food labels',()=>{
 assert.equal(categoryDefinitions.length,10);assert.equal(new Set(categoryDefinitions.map(c=>c.id)).size,10);
 assert.deepEqual(categoryDefinitions.map(c=>c.icon),['landmark','palette','footprints','leaf','utensils','shopping-bag','ticket','bed-double','train-front','clipboard-check']);
 for(const category of categoryDefinitions){assert.ok(category.description);assert.match(categoryIcon(category.icon),/^<svg.*aria-hidden="true"/);assert.match(categoryIcon(category.icon),/<(?:path|rect|circle|line|polyline)/);}
 for(const old of ['cafe','coffee','Кофе','Кафе','Рестораны','Еда'])assert.equal(categoryId(old),'food');
 assert.equal(categoryId('old-restaurant','Рестораны'),'food');assert.equal(categoryId('unknown'),null);
});

test('category migration retains every place, note, link, status setting, session and history record',async()=>{
 const DB=openDatabase(),oldDirectory=mkdtempSync(join(tmpdir(),'taiwan-old-categories-'));
 try{
  for(const file of ['0000_absurd_penance.sql','0001_accounts.sql','0002_status_symbols.sql','0003_status_transparency.sql'])copyFileSync('drizzle/'+file,join(oldDirectory,file));
  migrate(DB,oldDirectory);const call=await fixture(DB);
  for(const [i,c] of legacyCategories.entries())DB.sqlite.prepare('INSERT INTO categories VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,color=excluded.color,icon=excluded.icon,sort_order=excluded.sort_order').run(...c,i);
  DB.sqlite.prepare('UPDATE places SET category_id=? WHERE id=?').run('cafe','simple-kaffa');
  const keep=legacyCategories.map(c=>c[0]);for(const {id} of DB.sqlite.prepare('SELECT id FROM categories').all())if(!keep.includes(id))DB.sqlite.prepare('DELETE FROM categories WHERE id=?').run(id);
  const unchanged=['users','memberships','sessions','user_place_states','state_events','place_links','statuses'];
  const before=Object.fromEntries(unchanged.map(table=>[table,DB.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
  const places=DB.sqlite.prepare('SELECT * FROM places ORDER BY id').all();
  migrate(DB,'drizzle');migrate(DB,'drizzle');
  for(const table of unchanged)assert.deepEqual(DB.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all(),before[table],table);
  assert.deepEqual(DB.sqlite.prepare('SELECT * FROM places ORDER BY id').all().map(p=>({...p})),places.map(p=>({...p,category_id:p.category_id==='cafe'?'food':p.category_id})));
  const categories=DB.sqlite.prepare('SELECT * FROM categories ORDER BY sort_order').all();assert.equal(categories.length,10);
  for(const [i,category] of categories.entries())assert.deepEqual({...category},(({id,label,color,icon,sort_order})=>({id,label,color,icon,sort_order}))(categoryDefinitions[i]));
  assert.equal(DB.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
  const data=await(await call('/api/data')).json();assert.equal(data.categories.length,10);
  const ids=new Set(data.categories.map(c=>c.id));assert.ok(data.places.every(p=>ids.has(p.category_id)));
  assert.equal(data.places.find(p=>p.id==='simple-kaffa').note,'Preserve café note');
 }finally{DB.close();rmSync(oldDirectory,{recursive:true,force:true})}
});

test('imports of older six-category exports merge café and food while retaining place states',async()=>{
 const source=openDatabase(),target=openDatabase();try{
  migrate(source,'drizzle');migrate(target,'drizzle');const call=await fixture(source);
  const exported=await(await call('/api/export')).json();
  exported.categories=legacyCategories.map(([id,label,color,icon],sort_order)=>({id,label,color,icon,sort_order}));
  exported.places.find(p=>p.id==='simple-kaffa').category_id='cafe';
  assert.equal(target.sqlite.prepare('SELECT COUNT(*) n FROM categories').get().n,0);
  assert.equal(importExport(target,exported).places,exported.places.length);
  assert.equal(target.sqlite.prepare('SELECT COUNT(*) n FROM categories').get().n,10);
  assert.equal(target.sqlite.prepare('SELECT category_id FROM places WHERE id=?').get('simple-kaffa').category_id,'food');
  assert.equal(target.sqlite.prepare('SELECT note FROM user_place_states WHERE place_id=?').get('simple-kaffa').note,'Preserve café note');
  assert.equal(target.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{source.close();target.close()}
});

test('help uses current category labels and live editable status colors, symbols and transparency',()=>{
 const data={categories:categoryDefinitions,statuses:[{id:'want',label:'Хотим посетить',color:'#1456e0',symbol:'!'},{id:'visited',label:'Уже посетили',color:'#6b7280',symbol:'✓',dimmed:true},{id:'maybe',label:'Под вопросом',color:'#facc15',symbol:'?'},{id:'custom-hype',label:'Хайп!',color:'#dc2626',symbol:'★'}],user:{role:'viewer'}};
 let html=helpContent(data,esc);
 for(const category of data.categories)assert.ok(html.includes(category.label));
 for(const status of data.statuses){assert.ok(html.includes(status.label));assert.ok(html.includes(status.color));assert.ok(html.includes(status.symbol));}
 assert.ok(html.includes('--status-opacity:0.7'));assert.ok(html.includes('управляющий аккаунт ChatGPT'));
 assert.ok(html.includes('Самостоятельное добавление мест через интерфейс сайта пока недоступно'));
 assert.ok(html.includes('У вас доступ для просмотра'));assert.ok(!html.includes('Кнопка ⚙'));
 data.user.role='editor';data.statuses[0]={...data.statuses[0],label:'Новое <название>',color:'#112233',symbol:'&'};
 html=helpContent(data,esc);assert.ok(html.includes('Новое &lt;название&gt;'));assert.ok(html.includes('#112233'));assert.ok(html.includes('&amp;'));assert.ok(html.includes('Кнопка ⚙'));
 assert.ok(!html.includes('Хотим посетить'));assert.ok(!html.includes('<название>'));
});
