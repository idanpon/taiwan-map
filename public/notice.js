export function createNotice(element,{duration=6500}={}){
 const message=element.querySelector('.ui-notice-message');
 const button=element.querySelector('.ui-notice-action');
 let timer,action;
 button.onclick=()=>action?.run();
 function clear(){
  clearTimeout(timer);
  if(element.hidePopover&&element.matches(':popover-open'))element.hidePopover();
  element.hidden=true;action=null;
 }
 function show(text,{tone='neutral',action:nextAction}={}){
  clear();action=nextAction;
  element.dataset.tone=tone;
  element.hidden=false;
  button.hidden=!action;button.disabled=false;
  button.textContent=action?.label||'';
  element.showPopover?.();
  message.textContent=text;
  if(!action)timer=setTimeout(clear,duration);
 }
 return {show,clear,setActionBusy(value){button.disabled=value}};
}
