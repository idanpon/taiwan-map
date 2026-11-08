// Match the close button on a genuine backdrop tap. Touch does not depend on
// Safari synthesizing a click outside the native dialog.
export function installDialogBackdrop(dialog,{canClose=()=>true}={}){
 let pointerStart=null,touchStart=null;
 const outside=point=>{
  const r=dialog.getBoundingClientRect();
  return point.clientX<r.left||point.clientX>r.right||point.clientY<r.top||point.clientY>r.bottom;
 };
 const moved=(start,point)=>Math.hypot(point.clientX-start.clientX,point.clientY-start.clientY)>8;
 const hitBackdrop=(event,point)=>event.target===dialog&&outside(point);
 const dismiss=()=>{if(canClose())dialog.close()};
 dialog.addEventListener('pointerdown',event=>{
  pointerStart=event.isPrimary!==false&&(event.button??0)===0&&hitBackdrop(event,event)?event:null;
 });
 dialog.addEventListener('pointermove',event=>{if(pointerStart&&moved(pointerStart,event))pointerStart=null});
 dialog.addEventListener('pointercancel',()=>{pointerStart=null});
 dialog.addEventListener('click',event=>{
  const start=pointerStart;pointerStart=null;
  if(start&&hitBackdrop(event,event)&&!moved(start,event))dismiss();
 });
 dialog.addEventListener('touchstart',event=>{
  const point=event.touches[0];
  touchStart=event.touches.length===1&&hitBackdrop(event,point)?point:null;
 },{passive:true});
 dialog.addEventListener('touchmove',event=>{
  if(touchStart&&(event.touches.length!==1||moved(touchStart,event.touches[0]))){
   touchStart=null;pointerStart=null;
  }
 },{passive:true});
 dialog.addEventListener('touchcancel',()=>{touchStart=null;pointerStart=null},{passive:true});
 dialog.addEventListener('touchend',event=>{
  const start=touchStart;touchStart=null;pointerStart=null;
  if(!start||event.touches.length)return;
  const point=Array.from(event.changedTouches).find(touch=>touch.identifier===start.identifier);
  if(!point||!hitBackdrop(event,point)||moved(start,point))return;
  if(event.cancelable)event.preventDefault();
  dismiss();
 },{passive:false});
 dialog.addEventListener('close',()=>{touchStart=null;pointerStart=null});
}
