import test from 'node:test';
import assert from 'node:assert/strict';
import {weekSegments,isPeriod} from '../public/planning-layout.js';
import {monthDays,onDay,addDays} from '../public/planning-model.js';
import {swipeDirection,installPlanningNavigation} from '../public/planning-navigation.js';
import {page,topbarActions} from '../src/ui.mjs';
import {planningPage} from '../src/planning-ui.mjs';
const item=(id,start,end=start)=>({id,title:id,kind:'task',date_start:start,date_end:end,sort_order:0});
const zone='Asia/Taipei';
test('every month has six Monday-based rows, including empty February',()=>{
 for(let month=1;month<=12;month++){
  const days=monthDays(`2026-${String(month).padStart(2,'0')}-15`);
  assert.equal(days.length,42);assert.equal(new Date(days[0]+'T12:00Z').getUTCDay(),1);
  assert.equal(addDays(days[0],41),days.at(-1));
 }
});
test('periods span inclusive cells and continue across weeks without duplicating within a week',()=>{
 const periods=[item('long','2026-10-18','2026-11-03'),item('middle','2026-10-21','2026-10-23'),item('single','2026-10-23'),item('outside','2026-11-20')];
 const segments=weekSegments(periods,'2026-10-19',zone);
 assert.deepEqual(segments.map(s=>[s.item.id,s.column,s.span,s.lane,s.continuesBefore,s.continuesAfter]),[['long',0,7,0,true,true],['middle',2,3,1,false,false],['single',4,1,2,false,false]]);
 assert.equal(isPeriod(periods[0],zone),true);assert.equal(isPeriod(periods[2],zone),false);
 assert.equal(weekSegments(periods,'2026-11-02',zone)[0].span,2);
});
test('overlapping records never share a lane and every overflow count remains reachable by day',()=>{
 const items=Array.from({length:12},(_,n)=>item(String(n),addDays('2026-10-19',n%5),addDays('2026-10-19',Math.min(6,n%5+n%3))));
 const segments=weekSegments(items,'2026-10-19',zone);
 for(let day=0;day<7;day++){
  const present=segments.filter(s=>s.column<=day&&s.column+s.span>day);
  assert.equal(new Set(present.map(s=>s.lane)).size,present.length);
  assert.equal(present.length,items.filter(i=>onDay(i,addDays('2026-10-19',day),zone)).length);
  assert.equal(present.filter(s=>s.lane<3).length+present.filter(s=>s.lane>=3).length,present.length);
 }
 assert.deepEqual(weekSegments(items,'2026-12-01',zone),[]);
});
test('layout uses the chosen timezone for exact instants and preserves visit dates',()=>{
 const instant={...item('instant'),starts_at:'2026-10-19T23:00:00Z',ends_at:'2026-10-20T02:00:00Z'};
 assert.equal(weekSegments([instant],'2026-10-19','America/Los_Angeles')[0].column,0);
 assert.equal(weekSegments([instant],'2026-10-19',zone)[0].column,1);
 assert.equal(weekSegments([{...item('visit','2026-10-20'),kind:'visit'}],'2026-10-19','America/Los_Angeles')[0].column,1);
});
function surface(){const handlers={};return {handlers,addEventListener(type,fn,capture=false){handlers[type+(capture?'Capture':'')]=fn},setPointerCapture(){}}}
test('swipes reject vertical scroll, short gestures and long presses',()=>{
 const start={x:200,y:100,time:0};
 assert.equal(swipeDirection(start,{x:100,y:110,time:300}),1);
 assert.equal(swipeDirection(start,{x:300,y:110,time:300}),-1);
 for(const end of [{x:150,y:100,time:300},{x:100,y:220,time:300},{x:100,y:100,time:1500}])assert.equal(swipeDirection(start,end),0);
});
test('navigation respects inputs, modifiers, dialogs, list view and suppresses only swipe clicks',()=>{
 const canvas=surface(),document=surface(),moves=[];let enabled=true;
 installPlanningNavigation({canvas,document,navigate:n=>moves.push(n),enabled:()=>enabled});
 const target={closest:()=>null},input={closest:()=>true},key=(key,extra={})=>({key,target,preventDefault(){this.prevented=true},...extra});
 const left=key('ArrowLeft');document.handlers.keydown(left);assert.equal(left.prevented,true);
 for(const extra of [{target:input},{metaKey:true},{altKey:true}])document.handlers.keydown(key('ArrowRight',extra));
 enabled=false;document.handlers.keydown(key('ArrowRight'));enabled=true;
 const pointer=(x,y,time,extra={})=>({clientX:x,clientY:y,timeStamp:time,pointerId:1,button:0,isPrimary:true,target,...extra});
 canvas.handlers.pointerdown(pointer(200,50,0));canvas.handlers.pointerup(pointer(100,55,300));
 let suppressed=false;canvas.handlers.clickCapture({timeStamp:301,preventDefault(){},stopImmediatePropagation(){suppressed=true}});assert.equal(suppressed,true);
 canvas.handlers.pointerdown(pointer(200,50,900));canvas.handlers.pointercancel();canvas.handlers.pointerup(pointer(100,55,1000));
 canvas.handlers.pointerdown(pointer(200,50,1100));canvas.handlers.pointerdown(pointer(210,50,1200,{isPrimary:false}));canvas.handlers.pointerup(pointer(100,55,1300));
 assert.deepEqual(moves,[-1,1]);
});
test('map and planner share exactly the same header actions except the destination link',()=>{
 assert.ok(page.includes(topbarActions('map')));assert.ok(planningPage.includes(topbarActions('planning')));
 const suffix=markup=>markup.slice(markup.indexOf('<button id="help-open"'));
 assert.equal(suffix(topbarActions('map')),suffix(topbarActions('planning')));
 assert.match(topbarActions('planning'),/planning-nav[^]*<svg[^]*<span>Карта<\/span>/);
});
