export function swipeDirection(start,end){
 const dx=end.x-start.x,dy=end.y-start.y;
 return Math.abs(dx)>=60&&Math.abs(dx)>Math.abs(dy)*1.5&&end.time-start.time<1200?(dx<0?1:-1):0;
}
export function editableTarget(target){return Boolean(target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"]'))}
export function installPlanningNavigation({canvas,document,navigate,enabled}){
 let start=null,suppressUntil=0;
 canvas.addEventListener('pointerdown',event=>{
  if(!enabled()||event.isPrimary===false||event.button!==0||editableTarget(event.target)){start=null;return}
  start={id:event.pointerId,x:event.clientX,y:event.clientY,time:event.timeStamp};

 });
 canvas.addEventListener('pointermove',event=>{if(start&&event.pointerId===start.id&&Math.abs(event.clientX-start.x)>12&&Math.abs(event.clientX-start.x)>Math.abs(event.clientY-start.y)*1.5)canvas.setPointerCapture?.(event.pointerId)});
 canvas.addEventListener('pointercancel',()=>{start=null});
 canvas.addEventListener('pointerup',event=>{
  const origin=start;start=null;if(!origin||origin.id!==event.pointerId||!enabled())return;
  const direction=swipeDirection(origin,{x:event.clientX,y:event.clientY,time:event.timeStamp});
  if(direction){suppressUntil=event.timeStamp+500;navigate(direction)}
 });
 // A swipe starting on a record must not open that record on release.
 canvas.addEventListener('click',event=>{if(event.timeStamp<suppressUntil){event.preventDefault();event.stopImmediatePropagation()}},true);
 document.addEventListener('keydown',event=>{
  if(!enabled()||event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||editableTarget(event.target)||event.target?.closest?.('[data-view]'))return;
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();navigate(event.key==='ArrowLeft'?-1:1)}
 });
}
