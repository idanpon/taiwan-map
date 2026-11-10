const noticeDuration=6500;
const fadeDuration=500;

export function createNotice(element){
 const message=element.querySelector('.ui-notice-message');
 const button=element.querySelector('.ui-notice-action');
 let fadeTimer,hideTimer,action,remaining=null,started;
 button.onclick=()=>action?.run();
 button.addEventListener('focus',()=>{
  if(hideTimer===undefined)return;
  remaining=Math.max(0,remaining-(Date.now()-started));
  stopTimers();
  delete element.dataset.fading;
 });
 button.addEventListener('blur',schedule);
 function stopTimers(){
  clearTimeout(fadeTimer);
  clearTimeout(hideTimer);
  fadeTimer=hideTimer=undefined;
 }
 function startFade(){
  const duration=Math.min(fadeDuration,Math.max(0,remaining-(Date.now()-started)));
  element.style.setProperty('--ui-notice-fade-duration',duration+'ms');
  element.dataset.fading='';
 }
 function schedule(){
  if(remaining===null||hideTimer!==undefined||button.matches(':focus'))return;
  started=Date.now();
  hideTimer=setTimeout(clear,remaining);
  if(remaining>fadeDuration)fadeTimer=setTimeout(startFade,remaining-fadeDuration);
  else startFade();
 }
 function clear(){
  stopTimers();
  remaining=null;action=null;
  delete element.dataset.fading;
  if(element.hidePopover&&element.matches(':popover-open'))element.hidePopover();
  element.hidden=true;
 }
 function show(text,{tone='neutral',action:nextAction}={}){
  clear();action=nextAction;
  element.dataset.tone=tone;
  element.hidden=false;
  button.hidden=!action;button.disabled=false;
  button.textContent=action?.label||'';
  element.showPopover?.();
  message.textContent=text;
  remaining=noticeDuration;
  schedule();
 }
 return {show,clear,setActionBusy(value){button.disabled=value}};
}
