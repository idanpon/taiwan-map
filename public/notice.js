export function createNotice(element,{duration=6500}={}){
 const message=element.querySelector('.ui-notice-message');
 const button=element.querySelector('.ui-notice-action');
 let timer,action,remaining=null,started;
 button.onclick=()=>action?.run();
 button.addEventListener('focus',()=>{
  if(timer===undefined)return;
  clearTimeout(timer);
  timer=undefined;
  remaining=Math.max(0,remaining-(Date.now()-started));
 });
 button.addEventListener('blur',schedule);
 function schedule(){
  if(remaining===null||timer!==undefined||button.matches(':focus'))return;
  started=Date.now();
  timer=setTimeout(clear,remaining);
 }
 function clear(){
  clearTimeout(timer);
  timer=undefined;remaining=null;action=null;
  if(element.hidePopover&&element.matches(':popover-open'))element.hidePopover();
  element.hidden=true;
 }
 function show(text,{tone='neutral',action:nextAction,timeout}={}){
  clear();action=nextAction;
  element.dataset.tone=tone;
  element.hidden=false;
  button.hidden=!action;button.disabled=false;
  button.textContent=action?.label||'';
  element.showPopover?.();
  message.textContent=text;
  remaining=timeout??(action?null:duration);
  schedule();
 }
 return {show,clear,setActionBusy(value){button.disabled=value}};
}
