import {planningScrollArea,scrollPlanningBy,planningScrollBounds} from './planning-scroll.js';

// A DOM copy keeps the original geometry and rounded transparent corners.
export function installPlanningDrag({surface,document,window,enabled,onDrop,onDragEnd=()=>{},onBlocked=()=>{},onError}){
 let session=null,target=null,frame=0,suppressUntil=0;
 const holdMilliseconds=400,slop=8;
 function cancel(){
  const old=session,before=old?.preview?old.source.getBoundingClientRect().top:null;session=null;window.cancelAnimationFrame(frame);frame=0;
  document.body.classList.remove('planning-dragging');target?.classList.remove('is-drop-target');target=null;
  if(before!==null&&old.source.isConnected)scrollPlanningBy(old.scroller,old.source.getBoundingClientRect().top-before,window);
  if(!old)return;window.clearTimeout(old.timer);old.preview?.remove();old.source.classList.remove('is-drag-source');
  if(old.pointerId!==undefined&&old.source.hasPointerCapture(old.pointerId))old.source.releasePointerCapture(old.pointerId);
  if(old.preview)onDragEnd();
 }
 function sourceFor(element){
  if(!enabled())return null;
  if(element.closest('input,select,textarea,a,[contenteditable="true"]'))return null;
  const button=element.closest('button');if(button&&!button.hasAttribute('data-item'))return null;
  return element.closest('[data-drag-item]');
 }
 function updateTarget(){
  if(!session?.preview)return;
  const hit=document.elementFromPoint(session.x,session.y);
  const grid=hit?.closest('.planning-month-grid'),overGrid=Boolean(grid&&surface.contains(grid));
  if(overGrid)session.preview.classList.add('over-calendar');else session.preview.classList.remove('over-calendar');
  let next=hit?.closest('[data-drop-day]');
  if(!next?.dataset.dropDay||!surface.contains(next)||next.dataset.dropDay===session.anchor)next=null;
  if(next!==target){target?.classList.remove('is-drop-target');target=next;target?.classList.add('is-drop-target')}
 }
 function position(){
  const d=session;if(!d?.preview)return;
  d.preview.style.translate=`${d.x-d.offsetX}px ${d.y-d.offsetY}px`;
  updateTarget();
 }
 function scrollFrame(){
  if(!session?.preview)return;
  const bounds=surface.getBoundingClientRect(),{x,y}=session;
  if(x>=bounds.left&&x<=bounds.right){
   const hit=document.elementFromPoint(x,y),area=planningScrollArea(hit,window),edge=planningScrollBounds(area,window);
   const speed=y<edge.top?-10:y>edge.bottom?10:0;
   if(speed){scrollPlanningBy(area,speed,window);updateTarget()}
  }
  frame=window.requestAnimationFrame(scrollFrame);
 }
 function activate(){
  const d=session;if(!d||!enabled())return cancel();
  if('dragBlocked' in d.source.dataset){d.blocked=true;onBlocked();return}
  const before=d.source.getBoundingClientRect();
  d.preview=d.source.cloneNode(true);d.preview.classList.add('planning-drag-preview');d.preview.removeAttribute('data-drag-item');d.preview.setAttribute('aria-hidden','true');d.preview.inert=true;
  d.preview.style.width=before.width+'px';d.preview.style.height=before.height+'px';
  d.preview.style.transformOrigin=`${d.offsetX}px ${d.offsetY}px`;
  d.scroller=planningScrollArea(d.source,window);
  document.body.append(d.preview);d.source.classList.add('is-drag-source');document.body.classList.add('planning-dragging');
  // Revealing empty days above the source must not make it jump away from the finger.
  scrollPlanningBy(d.scroller,d.source.getBoundingClientRect().top-before.top,window);position();frame=window.requestAnimationFrame(scrollFrame);
 }
 function begin(source,x,y,pointerId,touchId){
  cancel();const rect=source.getBoundingClientRect();
  session={source,id:source.dataset.dragItem,anchor:source.dataset.anchorDay||null,x,y,startX:x,startY:y,offsetX:x-rect.left,offsetY:y-rect.top,pointerId,touchId,preview:null,timer:0};
  if(touchId!==undefined){const current=session;current.timer=window.setTimeout(()=>{if(session===current)activate()},holdMilliseconds)}
 }
 function finish(x,y){
  const d=session;if(!d)return false;d.x=x;d.y=y;const active=!!d.preview;
  if(active)updateTarget();const day=active?target?.dataset.dropDay:null;
  cancel();if(active||d.blocked)suppressUntil=Date.now()+500;
  if(day)Promise.resolve(onDrop(d.id,day,d.anchor)).catch(onError);
  return active||Boolean(d.blocked);
 }
 surface.addEventListener('pointerdown',event=>{
  if(event.pointerType==='touch'||event.button!==0)return;
  suppressUntil=0;
  const source=sourceFor(event.target);if(!source)return;
  begin(source,event.clientX,event.clientY,event.pointerId);source.setPointerCapture(event.pointerId);
 });
 surface.addEventListener('pointermove',event=>{
  const d=session;if(!d||d.blocked||d.touchId!==undefined||d.pointerId!==event.pointerId)return;
  d.x=event.clientX;d.y=event.clientY;
  if(!d.preview){if(Math.hypot(d.x-d.startX,d.y-d.startY)<6)return;activate()}
  event.preventDefault();position();
 });
 surface.addEventListener('pointerup',event=>{if(session?.touchId===undefined&&session?.pointerId===event.pointerId&&finish(event.clientX,event.clientY))event.preventDefault()});
 for(const name of ['pointercancel','lostpointercapture'])surface.addEventListener(name,event=>{if(session?.touchId===undefined&&session?.pointerId===event.pointerId){suppressUntil=Date.now()+500;cancel()}});
 surface.addEventListener('touchstart',event=>{
  if(event.touches.length!==1){cancel();return}
  suppressUntil=0;
  const source=sourceFor(event.target);if(!source)return;
  const touch=event.touches[0];begin(source,touch.clientX,touch.clientY,undefined,touch.identifier);
 },{passive:true});
 surface.addEventListener('touchmove',event=>{
  const d=session;if(d?.touchId===undefined)return;if(event.touches.length!==1){cancel();return}
  const touch=Array.from(event.touches).find(touch=>touch.identifier===d.touchId);if(!touch)return;
  d.x=touch.clientX;d.y=touch.clientY;
  if(d.blocked)return;
  if(!d.preview){if(Math.hypot(d.x-d.startX,d.y-d.startY)>slop){suppressUntil=Date.now()+500;cancel()}return}
  if(event.cancelable)event.preventDefault();position();
 },{passive:false});
 surface.addEventListener('touchend',event=>{if(session?.touchId===undefined)return;const touch=Array.from(event.changedTouches).find(touch=>touch.identifier===session.touchId);if(touch&&finish(touch.clientX,touch.clientY)&&event.cancelable)event.preventDefault()},{passive:false});
 surface.addEventListener('touchcancel',()=>{suppressUntil=Date.now()+500;cancel()});
 surface.addEventListener('contextmenu',event=>{if(sourceFor(event.target))event.preventDefault()});
 surface.addEventListener('dragstart',event=>{if(event.target.closest('.planning-card'))event.preventDefault()});
 surface.addEventListener('click',event=>{if(event.detail!==0&&Date.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation()}},true);
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&session){event.preventDefault();suppressUntil=Date.now()+500;cancel()}});
 window.addEventListener('blur',cancel);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel()});
 return {cancel,get active(){return !!session}};
}
