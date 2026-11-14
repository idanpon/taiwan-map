import test from 'node:test';
import assert from 'node:assert/strict';
import {routeFixture} from './route-ui-fixture.mjs';
import {routeUIScenario} from './route-ui-scenario.mjs';
import {executeAssistantTool} from '../src/assistant-tools.mjs';
import {saveProposal,previewProposal,applyProposal,readProposal,keepDraft,cancelProposal} from '../src/assistant-proposals.mjs';
import {getChangeset,applyChangeset} from '../src/planning-command-service.mjs';
import {previewPlanningImport,applyPlanningImport} from '../server/import-planning.mjs';

test('MCP route proposals use the shared preview, exact acknowledgements and durable receipt',async t=>{
 const f=await routeFixture(t),ids=routeUIScenario(f),u=f.users.editor,commands=[f.change('decisions',ids.decision.decision,'choose_working',{option_id:ids.early.option})],input={id:crypto.randomUUID(),title:'Ранний переезд',planning_commands:commands};
 const d=saveProposal(f.db,u,input),p=previewProposal(f.db,u,d.id,d.version),args={id:p.id,version:p.version,confirmation_token:p.preview.confirmation_token,confirmed_via:'chat'};
 assert(p.preview.acknowledgements.length);assert.equal(f.row('decisions',ids.decision.decision).working_option_id,ids.normal.option);
 assert.throws(()=>applyProposal(f.db,u,args),e=>e.details?.code==='ACKNOWLEDGEMENTS_REQUIRED');
 const receipt=applyProposal(f.db,u,{...args,acknowledgements:p.preview.acknowledgements.map(a=>a.key)});
 assert.equal(receipt.operation_id,getChangeset(f.db,u,p.domain_changeset_id).result.operation_id);assert.deepEqual(applyProposal(f.db,u,args),receipt);
 assert.equal(readProposal(f.db,u,p.id).status,'applied');assert.equal(f.row('services',ids.hotelService.service).date_end,'2035-01-07');
 const viewer=executeAssistantTool(f.env,f.users.viewer,'trip_read',{});assert.equal(viewer.planning_v3.schema_version,3);assert(!JSON.stringify(viewer).includes('password_hash'));assert(!JSON.stringify(viewer).includes('storage_key'));
 assert.throws(()=>saveProposal(f.db,f.users.viewer,{...input,id:crypto.randomUUID()}),e=>e.status===403);
 const comparison=executeAssistantTool(f.env,f.users.viewer,'planning_evaluate',{version:3,choices:[{decision_id:ids.decision.decision,option_id:ids.normal.option}]});assert.equal(comparison.context,'comparison');
});
test('discarding or editing a proposal invalidates shared consent; a direct shared receipt is recovered',async t=>{
 const f=await routeFixture(t),u=f.users.editor,make=()=>saveProposal(f.db,u,{id:crypto.randomUUID(),title:'Task',planning_commands:[{key:'new',type:'create_item',data:{kind:'task',title:'Task'}}]});
 const d=make(),p=previewProposal(f.db,u,d.id,d.version),old=p.preview.domain_changeset;
 keepDraft(f.db,u,p.id,p.version);assert.throws(()=>applyChangeset(f.db,u,old.id,{version:old.version,fingerprint:old.fingerprint,idempotency_key:'stale',acknowledgements:[]}),e=>e.status===409);
 const next=previewProposal(f.db,u,p.id,p.version);cancelProposal(f.db,u,p.id,p.version);assert.throws(()=>applyProposal(f.db,u,{id:p.id,version:p.version,confirmation_token:next.preview.confirmation_token,confirmed_via:'button'}),e=>e.status===409);
 const direct=make(),ready=previewProposal(f.db,u,direct.id,direct.version),shared=ready.preview.domain_changeset;
 const r=applyChangeset(f.db,u,shared.id,{version:shared.version,fingerprint:shared.fingerprint,idempotency_key:'direct',acknowledgements:ready.preview.acknowledgements.map(a=>a.key)});
 assert.equal(readProposal(f.db,u,direct.id).result.operation_id,r.operation_id);
});
test('model 3 import preview is private, apply is explicit, stale or changed manifests cannot duplicate writes',async t=>{
 const f=await routeFixture(t),manifest={schema_version:3,id:'route-demo-v1',commands:[{key:'new',type:'create_item',data:{kind:'task',title:'Imported'}}]},before=f.model().sources.items.length;
 const p=previewPlanningImport(f.db,manifest,'editor');assert.equal(f.model().sources.items.length,before);
 const receipt={id:p.id,version:p.version,fingerprint:p.preview.fingerprint,acknowledgements:p.preview.allowed_acknowledgements};
 assert.throws(()=>applyPlanningImport(f.db,receipt,'editor'),/confirmation/);
 const done=applyPlanningImport(f.db,{...receipt,confirmed:true},'editor');assert.deepEqual(applyPlanningImport(f.db,{...receipt,confirmed:true},'editor'),done);
 assert.equal(previewPlanningImport(f.db,manifest,'editor').result.operation_id,done.operation_id);assert.equal(f.model().sources.items.length,before+1);
 assert.throws(()=>previewPlanningImport(f.db,{...manifest,commands:[{...manifest.commands[0],data:{kind:'task',title:'Different'}}]},'editor'),/Manifest changed/);
 assert.throws(()=>previewPlanningImport(f.db,manifest,'other'),e=>e.status===404);
});
