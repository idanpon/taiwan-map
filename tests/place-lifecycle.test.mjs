import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../server/database.mjs';
import {handle,passwordHash,sha} from '../src/core.mjs';
import {readFileSync,mkdtempSync,copyFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function fixture(){
 const DB=openDatabase();migrate(DB,'drizzle');
 const env={DB,APP_ORIGIN:'https://api.example',FRONTEND_ORIGIN:'https://idanpon.github.io',AUTH_MODE:'bearer',APP_PASSWORD_HASH:await passwordHash('fixture-password')};
 const call=(path,method='GET',data,token='')=>handle(new Request(env.APP_ORIGIN+path,{method,headers:{Origin:env.FRONTEND_ORIGIN,...(token?{Authorization:'Bearer '+token}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
 const {token:owner}=await(await call('/api/login','POST',{password:'fixture-password'})).json();
 const tokens={owner};
 for(const [i,role] of ['admin','editor','viewer'].entries()){
  const id='test-'+role,token=String(i+1).repeat(64);tokens[role]=token;
  DB.sqlite.prepare('INSERT INTO users(id,display_name,created_at) VALUES(?,?,?)').run(id,role,1);
  DB.sqlite.prepare('INSERT INTO memberships VALUES(?,?,?)').run('taiwan-2026',id,role);
  DB.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await sha(token),id,Date.now()+1000000);
 }
 DB.sqlite.prepare("INSERT INTO app_meta VALUES('accounts_v1','shared')").run();
 return {DB,call,tokens,data:async role=>(await call('/api/data','GET',undefined,tokens[role])).json()};
}
test('editors and admins hide and restore shared places without losing notes, history, status or links; viewers cannot access the folder or mutate',async()=>{
 const f=await fixture();try{
  const id='taipei-101',original=(await f.data('editor')).places.find(p=>p.id===id);
  assert.equal(original.hidden,false);assert.equal(original.visibility_version,1);
  assert.equal((await f.call('/api/places/'+id+'/state','PUT',{version:0,status_id:'visited',note:'Keep all shared data'},f.tokens.editor)).status,200);
  const snapshot=Object.fromEntries(['user_place_states','state_events','place_links'].map(table=>[table,f.DB.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
  for(const [path,method,data] of [['/api/places/hidden','GET'],['/api/places/'+id+'/visibility','PUT',{version:1,hidden:true}],['/api/places/'+id,'DELETE',{version:1}]])assert.equal((await f.call(path,method,data,f.tokens.viewer)).status,403);
  assert.equal((await f.call('/api/places/'+id+'/visibility','PUT',{version:1,hidden:true},f.tokens.editor)).status,200);
  for(const role of ['admin','editor','viewer'])assert.ok(!(await f.data(role)).places.some(p=>p.id===id));
  const hidden=await(await f.call('/api/places/hidden','GET',undefined,f.tokens.admin)).json();
  assert.equal(hidden.places[0].note,'Keep all shared data');assert.equal(hidden.places[0].status_id,'visited');assert.equal(hidden.places[0].version,1);assert.equal(hidden.places[0].visibility_version,2);
  assert.equal((await f.call('/api/places/'+id+'/state','PUT',{version:1,status_id:null,note:'stale client'},f.tokens.editor)).status,404);
  assert.equal((await f.call('/api/places/'+id+'/visibility','PUT',{version:1,hidden:false},f.tokens.admin)).status,409);
  assert.equal((await f.call('/api/places/'+id+'/visibility','PUT',{version:2,hidden:false},f.tokens.admin)).status,200);
  const restored=(await f.data('editor')).places.find(p=>p.id===id);assert.equal(restored.note,'Keep all shared data');assert.equal(restored.visibility_version,3);
  for(const table of Object.keys(snapshot))assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all(),snapshot[table]);
  assert.deepEqual(f.DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{f.DB.close()}
});
test('permanent deletion removes all dependent rows and import metadata, survives stale requests and does not reseed the place',async()=>{
 const f=await fixture();try{
  const id='taipei-101',count=(await f.data('editor')).places.length;
  await f.call('/api/places/'+id+'/state','PUT',{version:0,status_id:'want',note:'Delete this note'},f.tokens.editor);
  f.DB.sqlite.prepare('INSERT INTO app_meta VALUES(?,?)').run('import:taiwan-trip-csv:TW001',JSON.stringify({place_id:id,row:{name:'Sensitive imported detail'}}));
  f.DB.sqlite.prepare('INSERT INTO app_meta VALUES(?,?)').run('import:unrelated','not json');
  const snapshot=f.DB.sqlite.prepare('SELECT * FROM user_place_states').all();
  assert.equal((await f.call('/api/places/'+id,'DELETE',{version:2},f.tokens.editor)).status,409);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM user_place_states').all(),snapshot);
  assert.ok(f.DB.sqlite.prepare('SELECT 1 FROM place_links WHERE place_id=?').get(id));
  assert.equal((await f.call('/api/places/'+id,'DELETE',{version:1},f.tokens.editor)).status,200);
  for(const table of ['place_links','user_place_states','state_events'])assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM '+table+' WHERE place_id=?').get(id).n,0);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM app_meta WHERE key=?').get('import:taiwan-trip-csv:TW001').n,0);
  assert.ok(f.DB.sqlite.prepare('SELECT 1 FROM app_meta WHERE key=?').get('import:unrelated'));
  assert.equal((await f.data('admin')).places.length,count-1);
  assert.equal((await f.call('/api/places/'+id,'DELETE',{version:1},f.tokens.admin)).status,404);
  assert.ok(!(await(await f.call('/api/export','GET',undefined,f.tokens.admin)).json()).places.some(p=>p.id===id));
  assert.deepEqual(f.DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{f.DB.close()}
});
test('hidden places remain in exports and are safely deleted from the folder; invalid and simultaneous requests cannot cross visibility versions',async()=>{
 const f=await fixture();try{
  const url='/api/places/taipei-101/visibility';
  for(const payload of [{hidden:true},{version:0,hidden:true},{version:1,hidden:'yes'}])assert.equal((await f.call(url,'PUT',payload,f.tokens.editor)).status,400);
  const results=await Promise.all([true,false].map(hidden=>f.call(url,'PUT',{version:1,hidden},f.tokens.editor)));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const exported=await(await f.call('/api/export','GET',undefined,f.tokens.admin)).json();const place=exported.places.find(p=>p.id==='taipei-101');assert.equal(place.hidden,results[0].status===200);
  if(!place.hidden)assert.equal((await f.call(url,'PUT',{version:2,hidden:true},f.tokens.editor)).status,200);
  assert.equal((await f.call('/api/places/taipei-101','DELETE',{version:place.hidden?2:3},f.tokens.admin)).status,200);
  assert.equal((await(await f.call('/api/places/hidden','GET',undefined,f.tokens.editor)).json()).places.length,0);
 }finally{f.DB.close()}
});
test('visibility migration preserves all existing place columns and rows, notes, sessions and import metadata',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'taiwan-before-hidden-')),DB=openDatabase();
 try{
  for(const name of readdirSync('drizzle').filter(x=>/^\d+.*\.sql$/.test(x)&&x!=='0005_hidden_places.sql'))copyFileSync('drizzle/'+name,join(directory,name));
  migrate(DB,directory);DB.sqlite.exec("INSERT INTO trips VALUES('trip','Trip','Asia/Taipei'); INSERT INTO categories VALUES('c','Category','#123456','leaf',0); INSERT INTO places VALUES('p','trip','Place','','City','c',25,121,'Address','Summary','Tip','{}','',1)");
  const before=DB.sqlite.prepare('SELECT * FROM places').get();migrate(DB,'drizzle');migrate(DB,'drizzle');
  assert.deepEqual({...DB.sqlite.prepare('SELECT * FROM places').get()},{...before,hidden:0,visibility_version:1});assert.deepEqual(DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{DB.close();rmSync(directory,{recursive:true,force:true})}
});

test('a database failure rolls back permanent deletion, including children already reached by the transaction',async()=>{
 const f=await fixture();try{
  await f.call('/api/places/taipei-101/state','PUT',{version:0,status_id:'want',note:'Keep after rollback'},f.tokens.editor);
  const before=Object.fromEntries(['places','state_events','user_place_states','place_links'].map(table=>[table,f.DB.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
  f.DB.sqlite.exec("CREATE TRIGGER fail_link_deletion BEFORE DELETE ON place_links BEGIN SELECT RAISE(ABORT,'test write failure'); END");
  assert.equal((await f.call('/api/places/taipei-101','DELETE',{version:1},f.tokens.editor)).status,500);
  for(const table of Object.keys(before))assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all(),before[table]);
 }finally{f.DB.close()}
});

test('a note request already reading its body cannot edit a place hidden in the meantime',{timeout:5000},async()=>{
 const f=await fixture();try{
  let reading,release;const atBody=new Promise(resolve=>reading=resolve),gate=new Promise(resolve=>release=resolve);
  const stream=new ReadableStream({async pull(controller){reading();await gate;controller.enqueue(new TextEncoder().encode(JSON.stringify({version:0,status_id:'want',note:'Must not appear'})));controller.close()}},{highWaterMark:0});
  const request=new Request('https://api.example/api/places/taipei-101/state',{method:'PUT',duplex:'half',headers:{Origin:'https://idanpon.github.io',Authorization:'Bearer '+f.tokens.editor,'Content-Type':'application/json'},body:stream});
  const pending=handle(request,{DB:f.DB,APP_ORIGIN:'https://api.example',FRONTEND_ORIGIN:'https://idanpon.github.io',AUTH_MODE:'bearer'});
  await atBody;assert.equal((await f.call('/api/places/taipei-101/visibility','PUT',{version:1,hidden:true},f.tokens.editor)).status,200);
  release();assert.equal((await pending).status,409);assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM user_place_states').get().n,0);assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM state_events').get().n,0);
 }finally{f.DB.close()}
});
