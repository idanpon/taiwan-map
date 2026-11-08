import test from 'node:test';import assert from 'node:assert/strict';
import {installDialogBackdrop} from '../public/dialogs.js';
function fixture(canClose=()=>true){
 const listeners={},dialog={closed:0,addEventListener:(name,fn)=>listeners[name]=fn,getBoundingClientRect:()=>({left:100,right:400,top:100,bottom:500}),close(){this.closed++}};
 installDialogBackdrop(dialog,{canClose});
 const event=(x,y,target=dialog)=>({clientX:x,clientY:y,target});
 const touch=(name,x,y,{target=dialog,multitouch=false}={})=>{
  const point={identifier:1,clientX:x,clientY:y},touches=name==='touchend'?[]:multitouch?[point,{identifier:2,clientX:x+10,clientY:y}]:[point];
  const e={...event(x,y,target),touches,changedTouches:[point],cancelable:true,preventDefault(){this.prevented=true}};
  listeners[name](e);return e;
 };
 return {dialog,touch,send:(name,x,y,target)=>listeners[name](event(x,y,target)),tap(x,y,target){listeners.pointerdown(event(x,y,target));listeners.click(event(x,y,target))}};
}
test('a backdrop tap closes a dialog on any side, while its content and padding do not',()=>{
 for(const [x,y] of [[50,200],[450,200],[250,50],[250,550]]){const f=fixture();f.tap(x,y);assert.equal(f.dialog.closed,1)}
 for(const [x,y] of [[100,100],[250,200],[400,500]]){const f=fixture();f.tap(x,y);assert.equal(f.dialog.closed,0)}
 const f=fixture();f.tap(250,200,{});assert.equal(f.dialog.closed,0);
});
test('dragging or selecting from inside to the backdrop does not dismiss the dialog',()=>{
 const f=fixture();f.send('pointerdown',250,200,{});f.send('click',50,200);assert.equal(f.dialog.closed,0);
 f.send('pointerdown',50,200);f.send('click',250,200);assert.equal(f.dialog.closed,0);
 f.send('pointerdown',50,200);f.send('pointercancel');f.send('click',50,200);assert.equal(f.dialog.closed,0);
});
test('busy dialogs keep the same close guard as their button, and synthetic clicks cannot dismiss them',()=>{
 let busy=true;const f=fixture(()=>!busy);f.tap(50,200);assert.equal(f.dialog.closed,0);
 busy=false;f.send('click',50,200);assert.equal(f.dialog.closed,0);
 f.tap(50,200);assert.equal(f.dialog.closed,1);
});
test('a tap above a sheet dismisses it at touchend, with no synthetic click needed',()=>{
 const f=fixture();
 f.send('pointerdown',250,50);f.touch('touchstart',250,50);
 assert.equal(f.touch('touchend',253,53).prevented,true);
 f.send('click',253,53);assert.equal(f.dialog.closed,1);
});
test('backdrop touch never closes on a slide, multitouch or a refused confirmation',()=>{
 const f=fixture();f.touch('touchstart',250,50);f.touch('touchmove',280,75);f.touch('touchend',250,50);
 f.touch('touchstart',250,50);f.touch('touchstart',250,50,{multitouch:true});f.touch('touchend',250,50);
 f.touch('touchstart',250,200,{target:{}});f.touch('touchend',250,50);
 assert.equal(f.dialog.closed,0);
 let guards=0;const refused=fixture(()=>{guards++;return false});
 refused.send('pointerdown',250,50);refused.touch('touchstart',250,50);
 assert.equal(refused.touch('touchend',250,50).prevented,true);
 refused.send('click',250,50);assert.equal(refused.dialog.closed,0);assert.equal(guards,1);
});
