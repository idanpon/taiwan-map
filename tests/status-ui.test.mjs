import test from 'node:test';import assert from 'node:assert/strict';
import {createStatusUI} from '../public/statuses.js';
function fixture({role='editor',save=async()=>({id:'new',label:'New',color:'#597b68',symbol:'!',version:1})}={}){
 const nodes=new Map(),calls=[],messages=[];let changes=0,focused=null;
 const $=id=>{
  if(!nodes.has(id)){
   const classes=new Set(),attributes={},listeners={};
   nodes.set(id,{value:'',checked:false,hidden:id==='status-form',style:{},attributes,listeners,classes,
    classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name)}},
    setAttribute(name,value){attributes[name]=value},removeAttribute(name){delete attributes[name]},
    addEventListener(name,handler){listeners[name]=handler},setCustomValidity(){},reportValidity:()=>true,
    focus(){focused=id},showModal(){this.open=true},close(){this.open=false},
    querySelectorAll:()=>[...nodes.values()]
   });
  }
  return nodes.get(id);
 };
 const data={user:{role},statuses:[{id:'existing',label:'Existing',color:'#123456',symbol:'?',dimmed:true,version:3}]};
 const ui=createStatusUI({$,esc:String,getData:()=>data,api:async(path,options)=>{calls.push({path,...options});return save(path,options)},onChange:()=>changes++,toast:text=>messages.push(text)});
 return {$,ui,data,calls,messages,get changes(){return changes},get focused(){return focused},
  edit(){ $('status-list').onclick({target:{closest:()=>({dataset:{editStatus:'existing'}})}}) },
  submit:()=>$('status-form').onsubmit({preventDefault(){}})};
}
test('new status starts collapsed, opens on demand and keeps a draft while toggling',()=>{
 for(const role of ['editor','admin']){
  const f=fixture({role});f.ui.open();assert.equal(f.$('status-form').hidden,true);assert.equal(f.$('status-new').attributes['aria-expanded'],'false');
  f.$('status-new').onclick();assert.equal(f.$('status-form').hidden,false);assert.equal(f.focused,'status-name');assert.equal(f.$('status-new').attributes['aria-expanded'],'true');
  f.$('status-name').value='Draft';f.$('status-symbol').value='!';f.$('status-new').onclick();assert.equal(f.$('status-form').hidden,true);
  f.$('status-new').onclick();assert.equal(f.$('status-name').value,'Draft');assert.equal(f.$('status-symbol').value,'!');
  assert.equal(f.calls.length,0);
 }
 const viewer=fixture({role:'viewer'});viewer.ui.open();assert.notEqual(viewer.$('status-dialog').open,true);
});
test('selecting an existing status opens editing, while New switches to a clean creation form',()=>{
 const f=fixture();f.ui.open();f.edit();assert.equal(f.$('status-form').hidden,false);assert.equal(f.$('status-name').value,'Existing');assert.equal(f.$('status-dimmed').checked,true);
 assert.equal(f.$('status-new').attributes['aria-expanded'],undefined);
 f.$('status-new').onclick();assert.equal(f.$('status-name').value,'');assert.equal(f.$('status-dimmed').checked,false);assert.equal(f.$('status-form').hidden,false);assert.equal(f.$('status-new').attributes['aria-expanded'],'true');
});
test('successful creation collapses and focuses New, editing remains open with the saved version',async()=>{
 const f=fixture({save:async(path,options)=>({id:path.endsWith('/existing')?'existing':'new',...JSON.parse(options.body),version:4})});f.ui.open();
 await f.submit();assert.equal(f.calls.length,0);
 f.$('status-new').onclick();f.$('status-name').value='New';await f.submit();assert.equal(f.calls[0].method,'POST');assert.equal(f.$('status-form').hidden,true);assert.equal(f.focused,'status-new');assert.equal(f.changes,1);assert.equal(f.data.statuses.length,2);
 f.edit();f.$('status-name').value='Updated';await f.submit();assert.equal(f.calls[1].method,'PUT');assert.equal(JSON.parse(f.calls[1].body).version,3);assert.equal(f.$('status-form').hidden,false);assert.equal(f.$('status-name').value,'Updated');assert.equal(f.data.statuses[0].version,4);
});
test('saving prevents collapsing and errors retain the open draft for correction',async()=>{
 let reject;const waiting=new Promise((resolve,no)=>{reject=no});const f=fixture({save:()=>waiting});f.ui.open();f.$('status-new').onclick();f.$('status-name').value='Keep this draft';
 const saving=f.submit();f.$('status-new').onclick();assert.equal(f.$('status-form').hidden,false);
 reject(new Error('Try again'));await saving;assert.equal(f.$('status-form').hidden,false);assert.equal(f.$('status-name').value,'Keep this draft');assert.equal(f.$('status-error').textContent,'Try again');assert.equal(f.$('status-new').disabled,false);
});
