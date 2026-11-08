import test from 'node:test';
import assert from 'node:assert/strict';
import {installPlanningDrag} from '../public/planning-drag.js';

const classes=()=>{const values=new Set();return {add:v=>values.add(v),remove:v=>values.delete(v),contains:v=>values.has(v)}};
const events=()=>({handlers:{},addEventListener(name,fn){this.handlers[name]=fn}});
function fixture(){
 const body={classList:classes(),append(node){this.preview=node}},surface=events(),document=events(),window=events();
 const area={scrollTop:30,getBoundingClientRect:()=>({top:200,bottom:500})};
 let preview,frame,drops=[],captures=false,pageScroll=0;
 const source={dataset:{dragItem:'task',anchorDay:'2026-11-07'},classList:classes(),isConnected:true,
  closest:()=>area,getBoundingClientRect:()=>({left:100,top:230-area.scrollTop,width:612,height:96}),
  cloneNode:()=>preview={style:{},classList:classes(),removeAttribute(){},setAttribute(){},remove(){this.removed=true},get offsetWidth(){return parseFloat(this.style.width)},get offsetHeight(){return parseFloat(this.style.height)}},
  setPointerCapture(){captures=true},hasPointerCapture:()=>captures,releasePointerCapture(){captures=false}};
 const node={closest:selector=>selector==='[data-drag-item]'?source:null};
 const destination={dataset:{dropDay:'2026-11-08'},classList:classes()};
 const hit={closest:selector=>selector==='[data-drop-day]'?destination:selector==='[data-planning-scroller]'?area:null};
 Object.assign(surface,{contains:()=>true,getBoundingClientRect:()=>({left:0,right:1000})});
 Object.assign(document,{body,hidden:false,elementFromPoint:()=>hit});
 Object.assign(window,{innerWidth:1000,innerHeight:700,getComputedStyle:()=>({overflowY:'auto'}),requestAnimationFrame:fn=>(frame=fn,1),cancelAnimationFrame(){},clearTimeout(){},scrollBy(x,y){pageScroll+=y}});
 const drag=installPlanningDrag({surface,document,window,enabled:()=>true,onDrop:(...args)=>drops.push(args),onError:error=>{throw error}});
 const event=(x,y,extra={})=>({target:node,clientX:x,clientY:y,pointerId:1,pointerType:'mouse',button:0,preventDefault(){},...extra});
 return {surface,document,window,body,area,source,destination,drag,event,drops,get preview(){return preview},tick:()=>frame(),pageScroll:()=>pageScroll};
}
test('drag preserves card dimensions, scrolls its pane and saves only after release',()=>{
 const f=fixture();f.surface.handlers.pointerdown(f.event(200,230));f.surface.handlers.pointermove(f.event(203,230));assert.equal(f.preview,undefined);
 f.surface.handlers.pointermove(f.event(300,475));assert.equal(f.preview.style.width,'612px');assert.equal(f.preview.style.height,'96px');assert.deepEqual(f.drops,[]);
 f.tick();assert.equal(f.area.scrollTop,40);assert.equal(f.pageScroll(),0);
 f.surface.handlers.pointerup(f.event(300,475));assert.deepEqual(f.drops,[['task','2026-11-08','2026-11-07']]);assert.equal(f.preview.removed,true);assert.equal(f.drag.active,false);
});
test('nested completion buttons, same-day drops and Escape never save a move',()=>{
 const f=fixture();f.surface.handlers.pointerdown(f.event(200,230,{target:{closest:selector=>selector==='button'?{hasAttribute:()=>false}:null}}));assert.equal(f.drag.active,false);
 f.destination.dataset.dropDay='2026-11-07';f.surface.handlers.pointerdown(f.event(200,230));f.surface.handlers.pointermove(f.event(300,240));f.surface.handlers.pointerup(f.event(300,240));assert.deepEqual(f.drops,[]);
 f.surface.handlers.pointerdown(f.event(200,230));f.surface.handlers.pointermove(f.event(300,240));f.document.handlers.keydown({key:'Escape',preventDefault(){}});assert.equal(f.preview.removed,true);assert.deepEqual(f.drops,[]);
});
