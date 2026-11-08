import test from 'node:test';import assert from 'node:assert/strict';
import {installSwipeGesture} from '../public/swipe-gesture.js';
import {installPlanningNavigation,createMonthWheelGesture} from '../public/planning-navigation.js';
import {installPlaceCardSwipe} from '../public/place-card-swipe.js';
function surface(){
 const handlers={};return {handlers,addEventListener(type,fn,options){handlers[type+(options===true||options?.capture?'Capture':'')]=fn},setPointerCapture(){}};
}
const target={closest:()=>null};
test('one horizontal trackpad gesture changes one month, including its inertial tail',()=>{
 const wheel=createMonthWheelGesture(),move=(x,y,time,deltaMode=0)=>wheel({deltaX:x,deltaY:y,timeStamp:time,deltaMode});
 assert.deepEqual(move(24,3,0),{claimed:true,direction:0});
 assert.deepEqual(move(34,4,16),{claimed:true,direction:1});
 for(let time=32;time<400;time+=16)assert.equal(move(20,1,time).direction,0);
 assert.equal(move(-60,0,700).direction,-1);
 assert.equal(move(4,0,1000,1).direction,1);
});
test('vertical trackpad scroll stays native and pinch, fields, cards and agenda never switch months',()=>{
 const wheel=createMonthWheelGesture();assert.equal(wheel({deltaX:2,deltaY:40,timeStamp:0}).claimed,false);assert.equal(wheel({deltaX:100,deltaY:0,timeStamp:16}).claimed,false);
 const canvas=surface(),document=surface(),moves=[];let enabled=true;
 installPlanningNavigation({canvas,document,navigate:n=>moves.push(n),enabled:()=>enabled});
 const event=(extra={})=>({target,timeStamp:0,deltaX:70,deltaY:0,cancelable:true,preventDefault(){this.prevented=true},...extra});
 for(const selector of ['input','planning-card','planning-day-panel'])canvas.handlers.wheel(event({target:{closest:s=>s.includes(selector)?{}:null}}));
 canvas.handlers.wheel(event({ctrlKey:true}));enabled=false;canvas.handlers.wheel(event());assert.deepEqual(moves,[]);
 enabled=true;const horizontal=event();canvas.handlers.wheel(horizontal);assert.equal(horizontal.prevented,true);assert.deepEqual(moves,[1]);
});
test('rapid consecutive strokes restart inside an inertial tail without any pointer movement',()=>{
 const wheel=createMonthWheelGesture(),directions=[];let time=0;
 const stroke=[18,38,30,20,12,7,4,2];
 for(let n=0;n<3;n++)for(const deltaX of stroke){const result=wheel({deltaX,deltaY:1,timeStamp:time});time+=20;if(result.direction)directions.push(result.direction)}
 assert.deepEqual(directions,[1,1,1]);
 for(const deltaX of [-16,-42,-28,-12,-5,-2]){const result=wheel({deltaX,deltaY:0,timeStamp:time});time+=20;if(result.direction)directions.push(result.direction)}
 assert.deepEqual(directions,[1,1,1,-1]);
});
test('a long decaying tail and small noisy rebound cannot trigger extra month changes',()=>{
 const wheel=createMonthWheelGesture(),directions=[];
 [60,48,40,32,24,18,12,7,4,2,4,2,1,2,0].forEach((deltaX,n)=>{const result=wheel({deltaX,deltaY:0,timeStamp:n*20});if(result.direction)directions.push(result.direction)});
 assert.deepEqual(directions,[1]);
});
test('large isolated wheel steps restart while dense or decaying events remain one gesture',()=>{
 for(const [events,expected] of [
  [[[0,1536],[63,1536],[113,1536]],[1,1,1]],
  [[[0,1536],[16,1536],[32,1536]],[1]],
  [[[0,1536],[60,900],[120,600],[180,300],[240,100]],[1]]
 ]){const wheel=createMonthWheelGesture();assert.deepEqual(events.map(([timeStamp,deltaX])=>wheel({timeStamp,deltaX,deltaY:0}).direction).filter(Boolean),expected)}
});
function touch(surface,type,x,y,time,{count=1,node=target}={}){
 const point={identifier:1,clientX:x,clientY:y},event={target:node,timeStamp:time,cancelable:true,touches:type==='touchend'?[]:Array.from({length:count},(_,i)=>({...point,identifier:i+1})),changedTouches:[point],preventDefault(){this.prevented=true}};
 surface.handlers[type](event);return event;
}
test('calendar claims a slightly diagonal touch before native scrolling, survives pointercancel and keeps its initial axis',()=>{
 const canvas=surface(),document=surface(),moves=[];installPlanningNavigation({canvas,document,navigate:n=>moves.push(n),enabled:()=>true});
 touch(canvas,'touchstart',200,100,0);
 assert.equal(touch(canvas,'touchmove',190,107,20).prevented,true);
 canvas.handlers.pointercancel({pointerType:'touch'});
 assert.equal(touch(canvas,'touchmove',100,220,200).prevented,true);
 touch(canvas,'touchend',100,220,220);assert.deepEqual(moves,[1]);
});
test('an initially vertical gesture stays native even if the finger later travels sideways',()=>{
 const canvas=surface(),finished=[];installSwipeGesture({surface:canvas,axis:'x',onFinish:d=>finished.push(d)});
 touch(canvas,'touchstart',100,200,0);
 assert.equal(touch(canvas,'touchmove',102,190,20).prevented,undefined);
 assert.equal(touch(canvas,'touchmove',220,180,200).prevented,undefined);
 touch(canvas,'touchend',220,180,220);assert.deepEqual(finished,[]);
});
test('a week table with native horizontal overflow never claims touch gestures',()=>{
 const canvas=surface(),document=surface(),moves=[],area={scrollWidth:980,clientWidth:393},node={closest:s=>s.includes('[data-planning-scroll]')?area:null};
 installPlanningNavigation({canvas,document,navigate:n=>moves.push(n),enabled:()=>true});
 touch(canvas,'touchstart',200,100,0,{node});assert.equal(touch(canvas,'touchmove',100,105,100,{node}).prevented,undefined);touch(canvas,'touchend',100,105,200,{node});assert.deepEqual(moves,[]);
});
test('pinch, touchcancel and a disabled surface cancel without completing a swipe',()=>{
 for(const mode of ['pinch','cancel','disabled']){
  const canvas=surface(),finished=[];let enabled=true;installSwipeGesture({surface:canvas,axis:'x',enabled:()=>enabled,onFinish:d=>finished.push(d)});
  touch(canvas,'touchstart',200,100,0);touch(canvas,'touchmove',180,102,20);
  if(mode==='pinch')touch(canvas,'touchstart',180,102,30,{count:2});else if(mode==='cancel')canvas.handlers.touchcancel();else enabled=false;
  touch(canvas,'touchend',50,105,200);assert.deepEqual(finished,[],mode);
 }
});
test('swipe clicks are suppressed, keyboard clicks and a fresh intentional tap remain available',()=>{
 const canvas=surface();installSwipeGesture({surface:canvas,axis:'x',onFinish:()=>{}});
 touch(canvas,'touchstart',200,100,0);touch(canvas,'touchmove',100,100,100);touch(canvas,'touchend',100,100,150);
 const click=detail=>({detail,timeStamp:160,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}});
 const ghost=click(1);canvas.handlers.clickCapture(ghost);assert.equal(ghost.stopped,true);
 const keyboard=click(0);canvas.handlers.clickCapture(keyboard);assert.equal(keyboard.stopped,undefined);
 touch(canvas,'touchstart',100,100,200);touch(canvas,'touchend',100,100,250);const tap=click(1);tap.timeStamp=251;canvas.handlers.clickCapture(tap);assert.equal(tap.stopped,undefined);
});
function cardFixture(){
 const card=surface(),document=surface(),styles=new Map(),classes=new Set(),body={scrollTop:0};let closed=0;
 card.style={setProperty:(k,v)=>styles.set(k,v),removeProperty:k=>styles.delete(k)};card.classList={add:v=>classes.add(v),remove:v=>classes.delete(v)};card.querySelector=()=>body;
 const gesture=installPlaceCardSwipe({card,document,enabled:()=>true,close:()=>closed++});
 const node=kind=>({closest:s=>s.includes('input,textarea')?(kind==='input'?{}:null):s==='.detail-header'?(kind==='header'?{}:null):null});
 const drag=(kind,dy=110)=>{const n=node(kind);touch(card,'touchstart',100,100,0,{node:n});const move=touch(card,'touchmove',103,100+dy,200,{node:n});touch(card,'touchend',103,100+dy,300,{node:n});return move};
 return {card,document,body,styles,classes,gesture,drag,closed:()=>closed};
}
test('a card can be pulled from its header or from the top of its body and always resets its transform',()=>{
 for(const kind of ['header','body']){const f=cardFixture();assert.equal(f.drag(kind).prevented,true);assert.equal(f.closed(),1);assert.equal(f.styles.size,0);assert.equal(f.classes.size,0)}
 const f=cardFixture();f.body.scrollTop=150;f.drag('header');assert.equal(f.closed(),1);
});
test('scrolling a card body, editing fields, upward pulls and short pulls do not dismiss it',()=>{
 const f=cardFixture();f.body.scrollTop=150;assert.equal(f.drag('body').prevented,undefined);assert.equal(f.closed(),0);
 f.body.scrollTop=0;f.drag('input');f.drag('body',-110);f.drag('header',20);assert.equal(f.closed(),0);assert.equal(f.styles.size,0);
});
test('dismissing a card blocks its ghost click but allows a fresh tap on the map immediately',()=>{
 const f=cardFixture();f.drag('header');
 const event=()=>({detail:1,timeStamp:310,preventDefault(){},stopImmediatePropagation(){this.stopped=true}});
 const ghost=event();f.document.handlers.clickCapture(ghost);assert.equal(ghost.stopped,true);
 f.document.handlers.pointerdownCapture({});const fresh=event();f.document.handlers.clickCapture(fresh);assert.equal(fresh.stopped,undefined);
});
