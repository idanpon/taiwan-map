import {installSwipeGesture} from './swipe-gesture.js';

export function swipeDirection(start,end,locked=false){
 const dx=end.x-start.x,dy=end.y-start.y;
 return Math.abs(dx)>=56&&(locked||Math.abs(dx)>Math.abs(dy)*1.1)&&end.time-start.time<1200?(dx<0?1:-1):0;
}
export function editableTarget(target){return Boolean(target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"]'))}
function nativeScrollTarget(target){const area=target?.closest?.('[data-planning-scroll]');return Boolean(area&&area.scrollWidth>area.clientWidth)}
function monthGestureTarget(target){return !editableTarget(target)&&!nativeScrollTarget(target)&&!target?.closest?.('.planning-card,.planning-day-panel')}

// WheelEvent has no portable gesture-end marker. A new stroke can overlap the
// previous inertial tail: detect renewed acceleration, not only an idle gap.
export function createMonthWheelGesture(){
 let last=-Infinity,x=0,y=0,axis=null,moved=false,peak=0,previous=0,tail=0,sign=0,movedAt=-Infinity;
 const reset=()=>{x=0;y=0;axis=null;moved=false;peak=0;previous=0;tail=0;sign=0};
 return event=>{
  const factor=event.deltaMode===1?16:event.deltaMode===2?320:1;
  const dx=event.deltaX*factor,dy=event.deltaY*factor,magnitude=Math.abs(dx),horizontal=magnitude>Math.abs(dy)*1.2;
  const reverse=moved&&horizontal&&magnitude>=8&&Math.sign(dx)!==sign;
  const renewed=moved&&horizontal&&tail>=2&&event.timeStamp-movedAt>=100&&magnitude>=Math.max(8,previous*2);
  // Some wheel devices/browser bridges emit a single large, fixed step per
  // stroke. Equal isolated steps are distinct commands, not a decaying tail.
  const step=moved&&horizontal&&magnitude>=240&&magnitude===previous&&event.timeStamp-last>=40;
  if(event.timeStamp-last>180||reverse||renewed||step)reset();
  last=event.timeStamp;x+=dx;y+=dy;
  if(!axis&&Math.max(Math.abs(x),Math.abs(y))>=6){if(Math.abs(x)>Math.abs(y)*1.2)axis='x';else if(Math.abs(y)>Math.abs(x)*1.2)axis='y'}
  const claimed=axis==='x';let direction=0;
  if(claimed&&!moved&&Math.abs(x)>=56){direction=x>0?1:-1;moved=true;movedAt=event.timeStamp;sign=direction}
  if(claimed){peak=Math.max(peak,magnitude);if(magnitude<=peak*.65&&magnitude<=previous*1.1)tail++;else if(magnitude>peak*.65)tail=0;previous=magnitude}
  return {claimed,direction};
 };
}
export function installPlanningNavigation({canvas,document,navigate,enabled}){
 installSwipeGesture({surface:canvas,axis:'x',enabled,canStart:event=>monthGestureTarget(event.target),
  // Once horizontal intent is locked, later vertical drift must not cancel it.
  onFinish:({dx,dy,duration})=>{const direction=swipeDirection({x:0,y:0,time:0},{x:dx,y:dy,time:duration},true);if(direction)navigate(direction)}
 });
 const wheel=createMonthWheelGesture();
 canvas.addEventListener('wheel',event=>{
  if(!enabled()||event.ctrlKey||event.metaKey||event.altKey||!monthGestureTarget(event.target))return;
  const {claimed,direction}=wheel(event);
  if(claimed&&event.cancelable)event.preventDefault();
  if(direction)navigate(direction);
 },{passive:false});
 document.addEventListener('keydown',event=>{
  if(!enabled()||event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||editableTarget(event.target)||event.target?.closest?.('button[data-view]')||nativeScrollTarget(event.target))return;
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();navigate(event.key==='ArrowLeft'?-1:1)}
 });
}
