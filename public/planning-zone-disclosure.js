export function installPlanningZoneDisclosure({container,button,popup,document,window}){
 const hover=()=>window.matchMedia('(min-width:721px) and (hover:hover) and (pointer:fine)').matches;
 const show=value=>{popup.hidden=!value;button.setAttribute('aria-expanded',String(value))};
 container.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch'&&hover())show(true)});
 container.addEventListener('pointerleave',event=>{if(event.pointerType!=='touch'&&hover()&&!container.contains(document.activeElement))show(false)});
 container.addEventListener('focusin',()=>{if(hover())show(true)});
 container.addEventListener('focusout',event=>{if(!container.contains(event.relatedTarget))show(false)});
 button.addEventListener('click',event=>{if(!hover()||event.detail===0)show(popup.hidden)});
 document.addEventListener('click',event=>{if(!container.contains(event.target))show(false)});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!popup.hidden){show(false);event.preventDefault()}});
}
