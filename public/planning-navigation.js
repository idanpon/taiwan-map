import {installSwipeGesture} from './swipe-gesture.js';

export function swipeDirection(start,end,locked=false){
 const dx=end.x-start.x,dy=end.y-start.y;
 return Math.abs(dx)>=56&&(locked||Math.abs(dx)>Math.abs(dy)*1.1)&&end.time-start.time<1200?(dx<0?1:-1):0;
}
export function editableTarget(target){return Boolean(target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"]'))}
function nativeScrollTarget(target){const area=target?.closest?.('[data-planning-scroll]');return Boolean(area&&area.scrollWidth>area.clientWidth)}
export function installPlanningNavigation({canvas,document,navigate,enabled}){
 installSwipeGesture({surface:canvas,axis:'x',enabled,canStart:event=>!editableTarget(event.target)&&!nativeScrollTarget(event.target),
  // Once horizontal intent is locked, later vertical drift must not cancel it.
  onFinish:({dx,dy,duration})=>{const direction=swipeDirection({x:0,y:0,time:0},{x:dx,y:dy,time:duration},true);if(direction)navigate(direction)}
 });
 document.addEventListener('keydown',event=>{
  if(!enabled()||event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||editableTarget(event.target)||event.target?.closest?.('button[data-view]')||nativeScrollTarget(event.target))return;
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();navigate(event.key==='ArrowLeft'?-1:1)}
 });
}
