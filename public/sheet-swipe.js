import {installSwipeGesture} from './swipe-gesture.js';

export function installSheetSwipe({card,document,enabled,close}){
 const reset=()=>{card.classList.remove('is-swiping');card.style.removeProperty('--ui-sheet-drag')};
 return installSwipeGesture({surface:card,axis:'y',direction:1,pointer:false,clickTarget:document,enabled,
  canStart:event=>{
   if(document.getSelection?.()?.type==='Range')return false;
   if(event.target.closest('input,textarea,select,a,summary,button:not(.copy-text),[contenteditable]:not([contenteditable="false"])'))return false;
   return Boolean(event.target.closest('.ui-overlay-heading'))||(card.querySelector('.ui-overlay-body')?.scrollTop||0)<=1;
  },
  onMove:({dy})=>{card.classList.add('is-swiping');card.style.setProperty('--ui-sheet-drag',Math.max(0,dy)+'px')},
  onFinish:({dy,duration})=>{reset();if((dy>=64&&duration<1500)||(dy>=40&&dy/Math.max(1,duration)>=.5))close()},
  onCancel:reset
 });
}
