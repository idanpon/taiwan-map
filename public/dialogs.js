// Match the close button on a genuine backdrop tap, including touch input.
// A selection/drag that starts inside the dialog must not dismiss it.
export function installDialogBackdrop(dialog,{canClose=()=>true}={}){
 let startedOutside=false;
 const outside=event=>{const r=dialog.getBoundingClientRect();return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom};
 dialog.addEventListener('pointerdown',event=>{startedOutside=event.target===dialog&&outside(event)});
 dialog.addEventListener('pointercancel',()=>{startedOutside=false});
 dialog.addEventListener('click',event=>{
  const dismiss=startedOutside&&event.target===dialog&&outside(event);startedOutside=false;
  if(dismiss&&canClose())dialog.close();
 });
}
