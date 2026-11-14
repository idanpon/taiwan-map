import assert from 'node:assert/strict';
import { openDatabase,migrate } from '../server/database.mjs';
import { seed } from '../src/seed.mjs';
import { TRIP,sha } from '../src/auth.mjs';
import { run } from '../src/sqlite.mjs';
import { upgradePlanningModel } from '../src/planning-upgrade.mjs';
import { readModel3,createChangeset,previewChangeset,applyChangeset } from '../src/planning-command-service.mjs';
import { handle } from '../src/core.mjs';

export const NOW=Date.parse('2030-01-01T00:00:00Z'),ref=(command,entity)=>({command,entity});
export async function routeFixture(t,{migrations='drizzle',upgrade=true,filename=':memory:'}={}){
 const db=openDatabase(filename);migrate(db,migrations);await seed(db);t.after(()=>db.close());
 run(db,"INSERT INTO app_meta(key,value) VALUES('accounts_v1','shared')");
 const users={},tokens={};
 for(const [id,role,n] of [['editor','editor','1'],['viewer','viewer','2'],['other','editor','3']]){
  users[id]={id,role};tokens[id]=n.repeat(64);
  run(db,'INSERT INTO users(id,display_name,created_at) VALUES(?,?,1)',id,id);
  run(db,'INSERT INTO memberships VALUES(?,?,?)',TRIP,id,role);
  run(db,'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',await sha(tokens[id]),id,Date.parse('2040-01-01'));
 }
 if(upgrade)upgradePlanningModel(db,users.editor,NOW);
 const model=()=>readModel3(db,users.editor,NOW),row=(collection,id)=>model().sources[collection].find(r=>r.id===id);
 const preview=(commands,user=users.editor)=>{const d=createChangeset(db,user,{version:3,commands},NOW);return previewChangeset(db,user,d.id,{version:d.version},NOW);};
 const apply=(p,user=users.editor)=>applyChangeset(db,user,p.id,{version:p.version,fingerprint:p.preview.fingerprint,idempotency_key:'test-'+p.id,acknowledgements:p.preview.allowed_acknowledgements},NOW);
 const write=commands=>{const p=preview(commands);assert.equal(p.preview.can_apply,true,JSON.stringify(p.preview.issues));apply(p);return p.preview.resolved_ids;};
 const change=(collection,id,type,fields={})=>({key:'change',type,id,expected_version:row(collection,id).version,...fields});
 const env={DB:db,APP_ORIGIN:'https://example.test',AUTH_MODE:'bearer'};
 async function call(path,method='GET',value,who='editor'){
  const res=await handle(new Request(env.APP_ORIGIN+path,{method,headers:{Origin:env.APP_ORIGIN,Authorization:'Bearer '+tokens[who],'Content-Type':'application/json'},...(value===undefined?{}:{body:JSON.stringify(value)})}),env);
  return {status:res.status,data:await res.json()};
 }
 return {db,users,tokens,env,model,row,preview,apply,write,change,call};
}
