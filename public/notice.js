import {installSwipeGesture} from './swipe-gesture.js';

const noticeDuration=6500;
const fadeDuration=500;

export function createNotice(element){
 const message=element.querySelector('.ui-notice-message');
 const button=element.querySelector('.ui-notice-action');
 const home=element.parentNode,nextSibling=element.nextSibling;
 let fadeTimer,hideTimer,action,content,current,waiting=false,remaining=null,started;
 let modal;
 button.onclick=()=>action?.run();
 element.addEventListener('focusin',pause);
 element.addEventListener('focusout',schedule);
 const swipe=installSwipeGesture({
  surface:element,axis:'x',pointer:false,enabled:()=>!element.hidden,
  onFinish:({dx})=>{if(Math.abs(dx)>=48)clear()}
 });
 function pause(){
  if(hideTimer===undefined)return;
  remaining=Math.max(0,remaining-(Date.now()-started));
  stopTimers();
  delete element.dataset.fading;
 }
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
  if(remaining===null||hideTimer!==undefined||waiting||element.matches(':focus-within'))return;
  started=Date.now();
  hideTimer=setTimeout(clear,remaining);
  if(remaining>fadeDuration)fadeTimer=setTimeout(startFade,remaining-fadeDuration);
  else startFade();
 }
 function placeInModal(){
  const doc=element.ownerDocument;
  if(!doc)return;
  const host=doc.activeElement?.closest('dialog:modal')??Array.from(doc.querySelectorAll('dialog:modal')).at(-1);
  if(!host)return;
  // Keep the popover interactive while the modal makes the rest of the page inert.
  modal=host;
  host.append(element);
  host.addEventListener('close',restorePlacement);
 }
 function restorePlacement(){
  if(!modal)return;
  modal.removeEventListener('close',restorePlacement);
  modal=null;
  if(element.hidePopover&&element.matches(':popover-open'))element.hidePopover();
  home.insertBefore(element,nextSibling);
  if(!element.hidden){
   placeInModal();
   element.showPopover?.();
   schedule();
  }
 }
 function clear(){
  stopTimers();
  remaining=null;action=null;current=null;waiting=false;
  content?.remove();content=null;
  swipe.cancel();
  delete element.dataset.fading;
  if(element.hidePopover&&element.matches(':popover-open'))element.hidePopover();
  element.hidden=true;
  restorePlacement();
 }
 function show(text,{tone='neutral',action:nextAction,content:nextContent}={}){
  clear();action=nextAction;content=nextContent;
  placeInModal();
  element.dataset.tone=tone;
  element.hidden=false;
  button.hidden=!action;button.disabled=false;
  button.textContent=action?.label||'';
  if(content)element.append(content);
  element.showPopover?.();
  message.textContent=text;
  remaining=noticeDuration;
  const shown={
   get active(){return current===shown},
   setWaiting(value){
    if(!shown.active)return;
    waiting=value;
    if(waiting)pause();
    else schedule();
   },
   dismiss(){if(shown.active)clear()}
  };
  current=shown;
  schedule();
  return shown;
 }
 return {show,clear,setActionBusy(value){button.disabled=value}};
}
