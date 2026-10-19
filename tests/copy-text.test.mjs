import test from 'node:test';import assert from 'node:assert/strict';
import {copyText,copyTextControl,installPlaceCopy} from '../public/copy-text.js';
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
test('copy actions send only the chosen original field, including Chinese and multiline addresses',async()=>{
 const values=[];for(const text of ['Raohe Night Market','饒河街觀光夜市','No. 1, Street\nTaipei'])assert.equal(await copyText(text,{navigator:{clipboard:{writeText:async value=>values.push(value)}}}),true);
 assert.deepEqual(values,['Raohe Night Market','饒河街觀光夜市','No. 1, Street\nTaipei']);assert.equal(await copyText('',{navigator:{}}),false);
});
function legacyFixture(success=true){
 const calls=[],active={focus:options=>calls.push(['restore',options])},input={style:{},setAttribute(){},focus(){},select(){calls.push('select')},setSelectionRange(start,end){calls.push([start,end])},remove(){calls.push('remove')}};
 const document={activeElement:active,createElement:()=>input,body:{append(){}},execCommand(command){calls.push(command);return success}};
 return {document,input,calls};
}
test('clipboard denial or unavailable API uses the fallback and cleans up focus and temporary text',async()=>{
 for(const denied of [true,false]){const f=legacyFixture();assert.equal(await copyText('台灣',{navigator:denied?{clipboard:{writeText:async()=>{throw new Error('denied')}}}:{},document:f.document}),true);assert.equal(f.input.value,'台灣');assert.equal(f.input.readOnly,true);assert.ok(f.calls.includes('copy'));assert.ok(f.calls.includes('remove'));assert.equal(f.calls.at(-1)[0],'restore')}
 const failed=legacyFixture(false);assert.equal(await copyText('Text',{navigator:{},document:failed.document}),false);assert.ok(failed.calls.includes('remove'));
});
test('delegated copy survives refreshed card content and reports failure without claiming success',async()=>{
 let handler,place={name:'English',local_name:'中文',address:'Address'};const copied=[],messages=[],root={addEventListener:(name,fn)=>handler=fn,contains:()=>true};let success=true;
 installPlaceCopy({root,getPlace:()=>place,toast:x=>messages.push(x),write:async text=>{copied.push(text);return success}});
 for(const field of ['name','local_name','address'])await handler({target:{closest:()=>({dataset:{copyField:field}})}});
 assert.deepEqual(copied,['English','中文','Address']);assert.deepEqual(messages,['Название скопировано','Китайское название скопировано','Адрес скопирован']);
 place={...place,name:'Refreshed'};await handler({target:{closest:()=>({dataset:{copyField:'name'}})}});assert.equal(copied.at(-1),'Refreshed');
 success=false;await handler({target:{closest:()=>({dataset:{copyField:'address'}})}});assert.match(messages.at(-1),/Не удалось/);
});
test('copy controls escape text, do not submit forms and omit missing fields',()=>{
 const html=copyTextControl('<img src=x>','name',esc);assert.ok(!html.includes('<img'));assert.match(html,/type="button"/);assert.match(html,/data-copy-field="name"/);assert.equal(copyTextControl('', 'local_name',esc),'');assert.equal(copyTextControl('x','unknown',esc),'');
});
function focusFixture(write=async()=>true){
 const handlers={},document={},button={dataset:{copyField:'name'},ownerDocument:document,blur(){if(document.activeElement===this)document.activeElement=null}};
 document.activeElement=button;
 installPlaceCopy({root:{addEventListener:(name,fn)=>handlers[name]=fn,contains:()=>true},getPlace:()=>({name:'Taipei'}),toast(){},write});
 return {handlers,button,document,click:detail=>handlers.click({detail,target:{closest:()=>button}})};
}
test('pointer copy clears its lingering focus after feedback, without blurring another field',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=focusFixture();await f.click(1);t.mock.timers.tick(1399);assert.equal(f.document.activeElement,f.button);t.mock.timers.tick(1);assert.equal(f.document.activeElement,null);
 f.document.activeElement=f.button;await f.click(1);const other={};f.document.activeElement=other;t.mock.timers.tick(1400);assert.equal(f.document.activeElement,other);
});
test('keyboard copy and navigation retain their visible focus, including a pending clipboard write',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=focusFixture();await f.click(0);t.mock.timers.tick(1500);assert.equal(f.document.activeElement,f.button);
 await f.click(1);f.handlers.keydown();t.mock.timers.tick(1500);assert.equal(f.document.activeElement,f.button);
 let finish;const pending=focusFixture(()=>new Promise(resolve=>finish=resolve));const action=pending.click(1);pending.handlers.keydown();finish(true);await action;t.mock.timers.tick(1500);assert.equal(pending.document.activeElement,pending.button);
});
