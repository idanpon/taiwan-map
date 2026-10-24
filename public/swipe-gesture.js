// Touch events keep tracking after a browser pointercancel. Claim the intended
// axis early with a non-passive move listener; leave the other axis native.
export function gestureAxis(dx,dy){
 if(Math.max(Math.abs(dx),Math.abs(dy))<6)return null;
 if(Math.abs(dx)>Math.abs(dy)*1.1)return 'x';
 if(Math.abs(dy)>Math.abs(dx)*1.1)return 'y';
 return null;
}
export function installSwipeGesture({surface,axis,direction=0,enabled=()=>true,canStart=()=>true,onMove=()=>{},onFinish,onCancel=()=>{},pointer=true,clickTarget=surface}){
 let gesture=null,suppressUntil=0,ignoreMouseUntil=0;
 const cancel=()=>{gesture=null;onCancel()};
 function begin(event,point,kind){
  cancel();suppressUntil=0;if(!enabled()||!canStart(event))return;
  gesture={x:point.clientX,y:point.clientY,id:kind==='touch'?point.identifier:event.pointerId,time:event.timeStamp,target:event.target,kind,locked:null};
 }
 function motion(event,point){
  const start=gesture;if(!start)return null;
  if(!enabled()){cancel();return null}
  const dx=point.clientX-start.x,dy=point.clientY-start.y;
  if(!start.locked){
   start.locked=gestureAxis(dx,dy);
   if(start.locked===axis&&direction&&Math.sign(axis==='x'?dx:dy)!==direction)start.locked='native';
  }
  return {dx,dy,duration:event.timeStamp-start.time,target:start.target};
 }
 function move(event,point){
  const delta=motion(event,point);if(!delta||gesture.locked!==axis)return;
  if(event.cancelable)event.preventDefault();
  if(gesture.kind==='pointer')try{surface.setPointerCapture?.(gesture.id)}catch{}
  onMove(delta);
 }
 function finish(event,point){
  const delta=motion(event,point),owned=gesture?.locked===axis;gesture=null;
  if(owned&&delta){suppressUntil=event.timeStamp+500;onFinish(delta)}
  else onCancel();
 }
 surface.addEventListener('touchstart',event=>{
  ignoreMouseUntil=event.timeStamp+800;
  if(event.touches.length!==1){cancel();return}
  begin(event,event.touches[0],'touch');
 },{passive:true});
 surface.addEventListener('touchmove',event=>{
  if(gesture?.kind!=='touch')return;
  if(event.touches.length!==1){cancel();return}
  const point=Array.from(event.touches).find(t=>t.identifier===gesture.id);if(point)move(event,point);
 },{passive:false});
 surface.addEventListener('touchend',event=>{
  if(gesture?.kind!=='touch')return;
  const point=Array.from(event.changedTouches).find(t=>t.identifier===gesture.id);if(point)finish(event,point);
 },{passive:true});
 surface.addEventListener('touchcancel',()=>{if(gesture?.kind==='touch')cancel()},{passive:true});
 if(pointer){
  surface.addEventListener('pointerdown',event=>{
   if(event.pointerType==='touch')return;
   if(event.timeStamp<ignoreMouseUntil||event.isPrimary===false||event.button!==0){cancel();return}
   begin(event,event,'pointer');
  });
  surface.addEventListener('pointermove',event=>{if(gesture?.kind==='pointer'&&gesture.id===event.pointerId)move(event,event)});
  surface.addEventListener('pointerup',event=>{if(gesture?.kind==='pointer'&&gesture.id===event.pointerId)finish(event,event)});
  surface.addEventListener('pointercancel',()=>{if(gesture?.kind==='pointer')cancel()});
 }
 // A drag must not activate the button underneath it, even when dismissal was refused.
 clickTarget.addEventListener('click',event=>{if(event.detail!==0&&event.timeStamp<suppressUntil){event.preventDefault();event.stopImmediatePropagation()}},true);
 if(clickTarget!==surface){
  // A new intentional tap elsewhere must not inherit the previous swipe's click guard.
  const fresh=()=>{suppressUntil=0};
  clickTarget.addEventListener('pointerdown',fresh,{capture:true,passive:true});
  clickTarget.addEventListener('touchstart',fresh,{capture:true,passive:true});
 }
 return {cancel};
}
