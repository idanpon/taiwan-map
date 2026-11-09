import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openDatabase, migrate } from '../server/database.mjs';
import { seed } from '../src/seed.mjs';
import { handle } from '../src/core.mjs';
import { sha, TRIP } from '../src/auth.mjs';
import { one, all, run, transaction } from '../src/sqlite.mjs';
import { saveProposal, readProposal, listProposals, previewProposal, applyProposal, keepDraft, cancelProposal } from '../src/assistant-proposals.mjs';
import { applyPlanningChange } from '../src/planning.mjs';
import { applyOperations } from '../src/assistant-changes.mjs';
import { applyWithRecovery } from '../public/assistant-card.js';
import { addDays } from '../public/planning-model.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function fixture(t){
  const DB=openDatabase();migrate(DB,'drizzle');await seed(DB);t.after(()=>DB.close());
  run(DB,"INSERT INTO app_meta VALUES('accounts_v1','shared')");
  const users={},tokens={};
  for(const [id,role] of [['alice','admin'],['bob','editor'],['viewer','viewer']]){
    run(DB,'INSERT INTO users(id,display_name,created_at) VALUES(?,?,?)',id,id,1);
    run(DB,'INSERT INTO memberships VALUES(?,?,?)',TRIP,id,role);
    tokens[id]=randomBytes(32).toString('hex');users[id]={id,role};
    run(DB,'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',await sha(tokens[id]),id,Date.now()+3600000);
  }
  const env={DB,APP_ORIGIN:'https://api.example',FRONTEND_ORIGIN:'https://site.example',AUTH_MODE:'bearer',ASSISTANT_ENABLED:'1',ASSISTANT_REDIRECT_URIS:'["https://chatgpt.com/connector/oauth/test"]',ASSISTANT_USER_IDS:'["alice","bob","viewer"]',ASSISTANT_UI_URL:'https://site.example/assistant.html'};
  const call=(path,method='GET',data,user='alice',origin=env.FRONTEND_ORIGIN)=>handle(new Request(env.APP_ORIGIN+path,{method,headers:{...(origin?{Origin:origin}:{}),...(user?{Authorization:'Bearer '+tokens[user]}:{}),...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),env,{clientIp:'test'});
  const form=(data,path='/api/assistant/oauth/token')=>handle(new Request(env.APP_ORIGIN+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data)}),env,{clientIp:crypto.randomUUID()});
  async function authorize(user='alice',extra={}){
    const verifier=randomBytes(32).toString('base64url');
    const params={client_id:'taiwan-chatgpt',redirect_uri:'https://chatgpt.com/connector/oauth/test',response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),state:'state-example',scope:'trip:read trip:write',resource:env.APP_ORIGIN+'/api/assistant/mcp',...extra};
    const response=await call('/api/assistant/consent','POST',{...params,approved:true},user);
    if(response.status!==200)return {response,params,verifier};
    const redirect=new URL((await response.json()).redirect);
    assert.equal(redirect.searchParams.get('state'),params.state);
    return {params,verifier,code:redirect.searchParams.get('code')};
  }
  const exchange=auth=>({client_id:auth.params.client_id,resource:auth.params.resource,grant_type:'authorization_code',code:auth.code,code_verifier:auth.verifier,redirect_uri:auth.params.redirect_uri});
  async function grant(user='alice',extra={}){const auth=await authorize(user,extra),r=await form(exchange(auth));assert.equal(r.status,200,await r.clone().text());return r.json();}
  return {DB,env,users,tokens,call,form,authorize,exchange,grant};
}
const placeData={name:'Новый музей',city:'Тайбэй',category_id:'sight',lat:25.023,lon:121.546,summary:'Описание',coordinate_accuracy:'Вход по официальной схеме',coordinate_source_url:'https://example.org/map'};
const createPlace=(extra={})=>({key:'museum',reason:'Пользователь хочет рассмотреть музей',kind:'place.create',data:{...placeData,...extra}});
const input=(operations)=>({id:crypto.randomUUID(),title:'Музей и подготовка',operations});
const accept=p=>({id:p.id,version:p.version,confirmation_token:p.preview.confirmation_token,confirmed_via:'button'});
const snapshot=db=>Object.fromEntries(['places','place_links','user_place_states','state_events','planning_items','planning_options','planning_item_places','planning_dependencies','planning_events','planning_reminders','push_deliveries','assistant_events'].map(table=>[table,all(db,'SELECT * FROM '+table+' ORDER BY rowid')]));

test('proposal preview rolls back; atomic apply and lost-response replay preserve notes and links',async t=>{
  const f=await fixture(t),u=f.users.alice;
  const request=input([createPlace(),{key:'book',kind:'plan.create',reason:'Проверить необходимость бронирования',data:{kind:'task',title:'Проверить билеты',places:[{place_id:'$museum'}]}}]);
  const saved=saveProposal(f.DB,u,request),before=snapshot(f.DB);
  assert.deepEqual(saveProposal(f.DB,u,request).ids,saved.ids);
  const preview=previewProposal(f.DB,u,saved.id,saved.version);
  assert.deepEqual(snapshot(f.DB),before);assert.equal(preview.preview.changes.length,2);
  assert.equal(previewProposal(f.DB,u,saved.id,1).preview.confirmation_token,preview.preview.confirmation_token);
  const receipt=applyProposal(f.DB,u,accept(preview)),after=snapshot(f.DB);
  assert.equal(receipt.status,'applied');assert.equal(receipt.changes.length,2);
  assert.equal(one(f.DB,'SELECT place_id FROM planning_item_places WHERE item_id=?',saved.ids.book).place_id,saved.ids.museum);
  assert.deepEqual(applyProposal(f.DB,u,accept(preview)),receipt);assert.deepEqual(snapshot(f.DB),after);
  assert.deepEqual(readProposal(f.DB,u,saved.id).result,receipt);
  assert.equal(all(f.DB,'PRAGMA foreign_key_check').length,0);
});

test('incomplete drafts are private; preview failure and last-operation failure roll back every write',async t=>{
  const f=await fixture(t),u=f.users.alice;
  const draft=saveProposal(f.DB,u,input([createPlace({lat:undefined,lon:undefined})]));
  assert.throws(()=>previewProposal(f.DB,u,draft.id,1),e=>e.status===400);
  assert.equal(readProposal(f.DB,u,draft.id).status,'draft');
  assert.equal(listProposals(f.DB,f.users.bob).proposals.length,0);
  assert.throws(()=>readProposal(f.DB,f.users.bob,draft.id),e=>e.status===404);
  assert.throws(()=>saveProposal(f.DB,f.users.viewer,input([createPlace()])),e=>e.status===403);
  const bad=saveProposal(f.DB,u,input([createPlace(),{key:'bad',kind:'plan.create',reason:'Проверка',data:{kind:'task',title:'Неверная дата',date_start:'2027-02-30'}}]));
  const before=snapshot(f.DB);
  assert.throws(()=>previewProposal(f.DB,u,bad.id,1),e=>e.status===400);assert.deepEqual(snapshot(f.DB),before);
  assert.throws(()=>transaction(f.DB,()=>applyOperations(f.DB,u,bad)),e=>e.status===400);assert.deepEqual(snapshot(f.DB),before);
});

test('an actual apply failure rolls back earlier writes and leaves no success receipt',async t=>{
  const f=await fixture(t),u=f.users.alice;
  const p=saveProposal(f.DB,u,input([createPlace(),{key:'task',kind:'plan.create',reason:'Проверка',data:{kind:'task',title:'Последняя операция'}}]));
  const ready=previewProposal(f.DB,u,p.id,1),before=snapshot(f.DB);
  f.DB.sqlite.exec("CREATE TEMP TRIGGER fail_assistant_task BEFORE INSERT ON planning_items BEGIN SELECT RAISE(ABORT,'test-only failure'); END");
  assert.throws(()=>applyProposal(f.DB,u,accept(ready)),/test-only failure/);
  assert.deepEqual(snapshot(f.DB),before);assert.equal(readProposal(f.DB,u,p.id).result,null);assert.equal(readProposal(f.DB,u,p.id).status,'ready');
});

test('edits, concurrent trip changes, cancellation and saved drafts invalidate prior confirmation',async t=>{
  const f=await fixture(t),u=f.users.alice;
  let p=saveProposal(f.DB,u,input([{key:'note',kind:'place.state',reason:'Заметка',id:'taipei-101',version:0,data:{note:'Наш план'}}]));
  p=previewProposal(f.DB,u,p.id,1);const token=p.preview.confirmation_token;
  run(f.DB,"UPDATE places SET summary='Concurrent edit' WHERE id='taipei-101'");
  assert.throws(()=>applyProposal(f.DB,u,accept(p)),e=>e.status===409);
  const newer=previewProposal(f.DB,u,p.id,1);assert.notEqual(newer.preview.confirmation_token,token);
  assert.throws(()=>applyProposal(f.DB,u,accept(p)),e=>e.status===409);
  keepDraft(f.DB,u,p.id,1);assert.throws(()=>applyProposal(f.DB,u,accept(newer)),e=>e.status===409);
  p=previewProposal(f.DB,u,p.id,1);applyProposal(f.DB,u,accept(p));
  let edit=saveProposal(f.DB,u,input([{key:'status',kind:'place.state',reason:'Уточнить статус',id:'taipei-101',version:1,data:{status_id:'want'}},{key:'info',kind:'place.update',reason:'Уточнить описание',id:'taipei-101',version:1,data:{summary:'Новое описание'}}]));
  edit=previewProposal(f.DB,u,edit.id,1);applyProposal(f.DB,u,accept(edit));
  assert.equal(one(f.DB,"SELECT note FROM user_place_states WHERE place_id='taipei-101'").note,'Наш план');
  const cancelled=saveProposal(f.DB,u,input([createPlace()]));cancelProposal(f.DB,u,cancelled.id,1);
  assert.throws(()=>previewProposal(f.DB,u,cancelled.id,1),e=>e.status===409);
  const revised=saveProposal(f.DB,u,input([createPlace()])),ready=previewProposal(f.DB,u,revised.id,1);
  const saved=saveProposal(f.DB,u,{...revised.input,id:revised.id,version:1,title:'Другое название'});assert.equal(saved.version,2);
  assert.throws(()=>applyProposal(f.DB,u,accept(ready)),e=>e.status===409);
});

test('decision safeguards are shared with the calendar; derived changes appear in preview',async t=>{
  const f=await fixture(t),u=f.users.alice;
  const response=applyPlanningChange(f.DB,u,{path:'/api/planning/items',method:'POST',body:{kind:'decision',title:'Выбрать башню',options:[{id:'go',label:'Идём'},{id:'skip',label:'Пропускаем'}],places:[{place_id:'taipei-101',option_id:'go',affects_visit:true,unselected_action:'hide'}]}});
  const item=(await response.json()).item;
  const bad=saveProposal(f.DB,u,input([{key:'s',kind:'place.state',id:'taipei-101',version:0,reason:'Статус',data:{status_id:'visited'}}]));
  assert.throws(()=>previewProposal(f.DB,u,bad.id,1),e=>e.status===409);
  const p=saveProposal(f.DB,u,input([{key:'choose',kind:'decision.resolve',id:item.id,version:item.version,reason:'Выбран вариант',data:{option_id:'go'}}]));
  const ready=previewProposal(f.DB,u,p.id,1);assert.ok(ready.preview.changes.some(c=>c.entity==='place'));
  applyProposal(f.DB,u,accept(ready));assert.equal(one(f.DB,"SELECT status_id FROM user_place_states WHERE place_id='taipei-101'").status_id,'want');
});

test('OAuth requires exact redirect, PKCE, resource, consent, site origin; codes are single-use',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call('/api/assistant/mcp','POST',{},null,null)).status,401);
  assert.equal((await f.call('/api/assistant/tool','POST',{name:'trip_read',arguments:{}},'alice',null)).status,403);
  assert.equal((await f.call('/api/assistant/tool','POST',{name:'trip_read',arguments:{}},'alice','https://evil.example')).status,403);
  const invalid=await f.authorize('alice',{redirect_uri:'https://evil.example'});assert.equal(invalid.response.status,400);
  const auth=await f.authorize();
  const redirect=await f.call('/api/assistant/oauth/authorize?'+new URLSearchParams(auth.params),'GET',undefined,null,null);assert.equal(redirect.status,302);assert.ok(redirect.headers.get('location').startsWith(f.env.ASSISTANT_UI_URL));
  assert.equal((await f.call('/api/assistant/oauth/authorize?'+new URLSearchParams(auth.params)+'&client_id=other','GET',undefined,null,null)).status,400);
  const b=f.exchange(auth);
  assert.equal((await f.form({...b,resource:'https://else.example'})).status,400);
  const bad=await f.form({...b,code_verifier:'x'.repeat(43)});assert.equal((await bad.json()).error,'invalid_grant');
  const good=await f.form(b);assert.equal(good.status,200);assert.equal((await good.json()).token_type,'Bearer');
  assert.equal((await f.form(b)).status,400);
  const second=await f.authorize();run(f.DB,'UPDATE assistant_oauth_codes SET expires_at=0');assert.equal((await f.form(f.exchange(second))).status,400);
  assert.equal((await f.authorize('alice',{scope:'admin'})).response.status,400);
  assert.equal((await f.authorize('alice',{code_challenge_method:'plain'})).response.status,400);
});

test('OAuth refresh rotates, revocation and account changes stop access; scopes bound writes',async t=>{
  const f=await fixture(t),g=await f.grant();
  const read=token=>handle(new Request(f.env.APP_ORIGIN+'/api/assistant/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'trip_read',arguments:{}}})}),f.env);
  assert.equal((await read(g.access_token)).status,200);
  const b={client_id:'taiwan-chatgpt',resource:f.env.APP_ORIGIN+'/api/assistant/mcp',grant_type:'refresh_token',refresh_token:g.refresh_token};
  const next=await (await f.form(b)).json();assert.ok(next.access_token);assert.equal((await read(g.access_token)).status,401);assert.equal((await f.form(b)).status,400);
  await f.form({client_id:'taiwan-chatgpt',token:next.refresh_token},'/api/assistant/oauth/revoke');assert.equal((await read(next.access_token)).status,401);
  const another=await f.grant();run(f.DB,"UPDATE users SET password_hash='reset' WHERE id='alice'");assert.equal((await read(another.access_token)).status,401);
  const disabled=await f.grant();run(f.DB,"UPDATE users SET disabled=1 WHERE id='alice'");assert.equal((await read(disabled.access_token)).status,401);
  const view=await f.grant('viewer');assert.equal(view.scope,'trip:read');
  const changed=await f.grant('bob');run(f.DB,"UPDATE memberships SET role='viewer' WHERE user_id='bob'");
  const write=await handle(new Request(f.env.APP_ORIGIN+'/api/assistant/mcp',{method:'POST',headers:{Authorization:'Bearer '+changed.access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'proposal_save',arguments:input([createPlace()])}})}),f.env);
  assert.equal((await write.json()).result.structuredContent.status,403);
});

test('official MCP client initializes, reads resource, saves, previews and applies exact proposal',async t=>{
  const f=await fixture(t),g=await f.grant(),client=new Client({name:'integration-test',version:'1'});
  const transport=new StreamableHTTPClientTransport(new URL(f.env.APP_ORIGIN+'/api/assistant/mcp'),{requestInit:{headers:{Authorization:'Bearer '+g.access_token}},fetch:(url,init)=>handle(new Request(url,init),f.env)});
  await client.connect(transport);t.after(()=>client.close());
  const rules = readFileSync(new URL('../docs/PLANNING_RULES.md', import.meta.url), 'utf8').trim();
  assert.ok(client.getInstructions().includes(rules));
  const {tools}=await client.listTools();assert.equal(tools.length,8);
  assert.match(tools.find(t=>t.name==='proposal_save').description,/trip_read.*planning_rules.*planning_today/);
  const ui=tools.find(t=>t.name==='proposal_preview')._meta.ui;assert.ok(ui.resourceUri);assert.deepEqual(ui.visibility,['model','app']);
  const resource=await client.readResource({uri:ui.resourceUri});assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');assert.ok(resource.contents[0].text.includes('Подтвердить изменения'));
  run(f.DB, 'INSERT INTO trip_timezone_changes(trip_id,at,zone) VALUES(?,?,?)', TRIP, Date.now()-60000, 'Asia/Taipei');
  const context=await client.callTool({name:'trip_read',arguments:{}});assert.equal(context.structuredContent.actor.id,'alice');assert.equal(JSON.stringify(context).includes('password_hash'),false);
  const trip = context.structuredContent;
  assert.equal(trip.planning_rules, rules);
  assert.equal(JSON.parse(context.content[0].text).planning_rules, rules);
  assert.equal(trip.planning_today.timezone, 'Asia/Taipei');
  const deadline = addDays(trip.planning_today.date, 1);
  const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent;};
  const task = {key:'tickets',kind:'plan.create',reason:'Подготовка поездки',data:{kind:'task',title:'Купить билеты на поезд',date_end:deadline}};
  const p=await call('proposal_save',input([createPlace(),task]));const preview=await call('proposal_preview',{id:p.id,version:1});
  const taskPreview = preview.preview.changes.find(change=>change.entity==='plan').after;
  assert.equal(taskPreview.date_start, null);
  assert.equal(taskPreview.date_end, deadline);
  const receipt=await call('proposal_apply',accept(preview));assert.equal(receipt.status,'applied');assert.equal((await call('proposal_read',{id:p.id})).result.operation_id,receipt.operation_id);
  const savedTask = one(f.DB, 'SELECT date_start,date_end FROM planning_items WHERE id=?', p.ids.tickets);
  assert.equal(savedTask.date_start, null);
  assert.equal(savedTask.date_end, deadline);
  const extra=await client.callTool({name:'trip_read',arguments:{sql:'DELETE'}});assert.equal(extra.isError,true);
  const unknown=await client.callTool({name:'delete_all',arguments:{}});assert.equal(unknown.isError,true);
});

test('recovery checks durable receipt before retry and does not retry validation/conflicts',async()=>{
  const p={id:crypto.randomUUID(),version:1,preview:{confirmation_token:'a'.repeat(48)}},receipt={status:'applied'},calls=[];
  const result=await applyWithRecovery(async(name,args)=>{calls.push({name,args});if(name==='proposal_apply')throw new Error('Response lost');return {status:'applied',result:receipt};},p);
  assert.deepEqual(result,receipt);assert.deepEqual(calls.map(c=>c.name),['proposal_apply','proposal_read']);
  let count=0;await assert.rejects(applyWithRecovery(async()=>{count++;const e=new Error('Changed');e.status=409;throw e;},p));assert.equal(count,1);
});

test('feature is off by default; read-only grants cannot save and expiry is enforced',async t=>{
  const f=await fixture(t),g=await f.grant('alice',{scope:'trip:read'});
  const empty={...f.env,ASSISTANT_USER_IDS:'[]',ASSISTANT_REDIRECT_URIS:'[]'};
  assert.equal((await handle(new Request(f.env.APP_ORIGIN+'/.well-known/oauth-authorization-server'),empty)).status,200);
  assert.equal((await handle(new Request(f.env.APP_ORIGIN+'/api/assistant/connections',{headers:{Authorization:'Bearer '+f.tokens.alice}}),empty)).status,403);
  const request=()=>new Request(f.env.APP_ORIGIN+'/api/assistant/mcp',{method:'POST',headers:{Authorization:'Bearer '+g.access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'proposal_save',arguments:input([createPlace()])}})});
  assert.equal((await handle(request(),{...f.env,ASSISTANT_ENABLED:undefined})).status,404);
  assert.equal((await (await handle(request(),f.env)).json()).result.structuredContent.status,403);
  run(f.DB,'UPDATE assistant_oauth_grants SET access_expires_at=0');assert.equal((await handle(request(),f.env)).status,401);
});
