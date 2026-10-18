import test from 'node:test';import assert from 'node:assert/strict';
import {installDialogBackdrop} from '../public/dialogs.js';
function fixture(canClose=()=>true){
 const listeners={},dialog={closed:0,addEventListener:(name,fn)=>listeners[name]=fn,getBoundingClientRect:()=>({left:100,right:400,top:100,bottom:500}),close(){this.closed++}};
 installDialogBackdrop(dialog,{canClose});
 const event=(x,y,target=dialog)=>({clientX:x,clientY:y,target});
 return {dialog,send:(name,x,y,target)=>listeners[name](event(x,y,target)),tap(x,y,target){listeners.pointerdown(event(x,y,target));listeners.click(event(x,y,target))}};
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
