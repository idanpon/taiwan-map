import test from 'node:test';
import assert from 'node:assert/strict';
import {scrollFade} from '../public/planning-viewport.js';
import {installPlanningZoneDisclosure} from '../public/planning-zone-disclosure.js';
test('scroll fade indicates only hidden content, including fractional scroll and short lists',()=>{
 assert.deepEqual(scrollFade(0,500,900),{top:0,bottom:16});
 assert.deepEqual(scrollFade(200,500,900),{top:16,bottom:16});
 assert.deepEqual(scrollFade(399.7,500,900),{top:16,bottom:0});
 assert.deepEqual(scrollFade(0,500,400),{top:0,bottom:0});
 assert.deepEqual(scrollFade(-5,500,900),{top:0,bottom:16});
 assert.deepEqual(scrollFade(4,500,508),{top:4,bottom:4});
});
function fixture(hover){
 const node=()=>({handlers:{},addEventListener(name,fn){this.handlers[name]=fn}});
 const container=node(),button=node(),document=node(),popup={hidden:true};
 container.contains=value=>value===button||value===popup;button.setAttribute=(k,v)=>{button[k]=v};
 installPlanningZoneDisclosure({container,button,popup,document,window:{matchMedia:()=>({matches:hover})}});
 return {container,button,popup,document};
}
test('desktop timezone disclosure opens on hover and remains readable over its popup',()=>{
 const f=fixture(true);f.container.handlers.pointerenter({pointerType:'mouse'});assert.equal(f.popup.hidden,false);assert.equal(f.button['aria-expanded'],'true');
 f.document.handlers.click({target:f.popup});assert.equal(f.popup.hidden,false);
 f.container.handlers.pointerleave({pointerType:'mouse'});assert.equal(f.popup.hidden,true);
 f.container.handlers.focusin();assert.equal(f.popup.hidden,false);
 f.document.handlers.keydown({key:'Escape',preventDefault(){}});assert.equal(f.popup.hidden,true);
});
test('touch timezone disclosure ignores hover and toggles by tap or outside press',()=>{
 const f=fixture(false);f.container.handlers.pointerenter({pointerType:'touch'});f.container.handlers.focusin();assert.equal(f.popup.hidden,true);
 f.button.handlers.click({detail:1});assert.equal(f.popup.hidden,false);
 f.button.handlers.click({detail:1});assert.equal(f.popup.hidden,true);
 f.button.handlers.click({detail:1});f.document.handlers.click({target:{}});assert.equal(f.popup.hidden,true);
});
