import test from 'node:test';
import assert from 'node:assert/strict';
import {installPlanningLayout,scrollFade} from '../public/planning-viewport.js';
import {installPlanningZoneDisclosure} from '../public/planning-zone-disclosure.js';
test('scroll fade indicates only hidden content, including fractional scroll and short lists',()=>{
 assert.deepEqual(scrollFade(0,500,900),{top:0,bottom:16});
 assert.deepEqual(scrollFade(200,500,900),{top:16,bottom:16});
 assert.deepEqual(scrollFade(399.7,500,900),{top:16,bottom:0});
 assert.deepEqual(scrollFade(0,500,400),{top:0,bottom:0});
 assert.deepEqual(scrollFade(-5,500,900),{top:0,bottom:16});
 assert.deepEqual(scrollFade(4,500,508),{top:4,bottom:4});
});
function listFixture(wide){
 const events=()=>({handlers:{},addEventListener(name,fn){this.handlers[name]=fn},removeEventListener(name){delete this.handlers[name]}});
 const viewport={clientHeight:500,scrollHeight:1500};
 const window={...events(),innerHeight:500,scrollY:0,scrollTo(x,y){this.scrollY=y},
  matchMedia:()=>({matches:wide}),getComputedStyle:()=>({scrollPaddingBlockStart:'16px'}),
  ResizeObserver:class{observe(){} disconnect(){}}};
 let keyboardFocus=false,dragging=false;
 const topButton={...events(),hidden:true,matches:()=>keyboardFocus};
 const setPosition=position=>{if(wide)scroller.scrollTop=position;else window.scrollY=position};
 const today={style:{},scrollIntoView:()=>setPosition(875),
  parentElement:{getBoundingClientRect:()=>({bottom:1000})},getBoundingClientRect:()=>({top:100})};
 const scroller={...events(),...viewport,scrollTop:0,offsetWidth:800,clientWidth:800,children:[],
  dataset:{planningScroller:'list'},style:{setProperty(){}},querySelector:()=>today,
  getBoundingClientRect:()=>({top:200-window.scrollY})};
 const canvas={ownerDocument:{scrollingElement:viewport,body:{classList:{contains:()=>dragging}}},
  querySelector:selector=>selector==='[data-planning-scroller]'?scroller:null};
 const layout=installPlanningLayout({canvas,topbar:{offsetHeight:56},topButton,window});
 const refresh=position=>layout.refresh({scrollTop:wide?position:0,pageTop:wide?0:position});
 const scroll=position=>{setPosition(position);(wide?scroller:window).handlers.scroll()};
 refresh(0);
 return {layout,topButton,scroll,refresh,setPosition,setDragging:value=>{dragging=value},
  focus:()=>{keyboardFocus=true},blur:()=>{keyboardFocus=false;topButton.handlers.blur()}};
}
test('list return button reveals on a deliberate reversal and hides after scrolling farther',()=>{
 for(const wide of [false,true]){
  const f=listFixture(wide);
  f.scroll(650);assert.equal(f.topButton.hidden,true);
  f.scroll(633);f.scroll(616);f.scroll(603);assert.equal(f.topButton.hidden,true);
  f.scroll(602);assert.equal(f.topButton.hidden,false);
  f.scroll(625);assert.equal(f.topButton.hidden,false);
  f.scroll(626);assert.equal(f.topButton.hidden,true);
  f.scroll(578);assert.equal(f.topButton.hidden,false);
  f.scroll(359);assert.equal(f.topButton.hidden,true);
 }
});
test('overscroll and programmatic list jumps do not count as a reversal',()=>{
 const f=listFixture(false);
 f.refresh(900);
 f.scroll(1000);f.scroll(1065);f.scroll(1000);assert.equal(f.topButton.hidden,true);
 f.scroll(952);assert.equal(f.topButton.hidden,false);
 f.layout.scrollListToToday();
 f.scroll(875);assert.equal(f.topButton.hidden,true);
 f.setDragging(true);f.scroll(990);f.scroll(900);assert.equal(f.topButton.hidden,true);
 f.setDragging(false);f.setPosition(830);f.layout.resetScrollTracking();
 f.scroll(830);assert.equal(f.topButton.hidden,true);
 f.scroll(782);assert.equal(f.topButton.hidden,false);
 f.refresh(900);f.scroll(900);assert.equal(f.topButton.hidden,false);
});
test('a focused return button stays available until keyboard focus leaves',()=>{
 const f=listFixture(true);
 f.scroll(700);f.scroll(650);f.focus();f.scroll(674);
 assert.equal(f.topButton.hidden,false);
 f.blur();assert.equal(f.topButton.hidden,true);
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
