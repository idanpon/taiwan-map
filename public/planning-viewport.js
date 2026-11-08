// Wheel streams remain targeted at the hovered DOM node until the pointer moves.
// Preserve all 42 calendar slots (unused final weeks are hidden), including their
// descendants, instead of removing the wheel target when changing months.
function syncNode(current,next){
 if(current.nodeType===3){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return}
 for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name))current.removeAttribute(attr.name);
 for(const attr of next.attributes)if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
 const old=[...current.childNodes],fresh=[...next.childNodes];
 for(let i=0;i<Math.max(old.length,fresh.length);i++){
  if(!fresh[i])old[i].remove();else if(!old[i])current.append(fresh[i]);
  else if(old[i].nodeType===fresh[i].nodeType&&old[i].nodeName===fresh[i].nodeName)syncNode(old[i],fresh[i]);
  else old[i].replaceWith(fresh[i]);
 }
}
export function renderPlanningCanvas(canvas,html){
 const template=canvas.ownerDocument.createElement('template');template.innerHTML=html;
 const old=canvas.querySelector('.planning-month-layout'),next=template.content.querySelector('.planning-month-layout');
 if(!old||!next){canvas.replaceChildren(template.content);return}
 old.style.cssText=next.style.cssText;
 syncNode(old.querySelector('.planning-month-panel'),next.querySelector('.planning-month-panel'));
 syncNode(old.querySelector('.planning-agenda-heading'),next.querySelector('.planning-agenda-heading'));
 old.querySelector('.planning-day-panel').replaceWith(next.querySelector('.planning-day-panel'));
}
export function scrollFade(top,height,total,size=16){
 const remaining=Math.max(0,total-height-top);
 return {top:top>1?Math.min(size,top):0,bottom:remaining>1?Math.min(size,remaining):0};
}
export function installPlanningLayout({canvas,window}){
 let scroller=null;
 function update(){
  const desktop=window.matchMedia('(min-width:721px)').matches;
  const panel=canvas.querySelector('.planning-month-panel');
  if(panel&&desktop){
   const fixed=28+panel.querySelector('.planning-month-legend').offsetHeight+2;
   panel.style.setProperty('--planning-week-height',Math.max(0,(canvas.clientHeight-fixed)/6)+'px');
  }
  if(!scroller)return;
  const edge=desktop?scrollFade(scroller.scrollTop,scroller.clientHeight,scroller.scrollHeight):{top:0,bottom:0};
  scroller.style.setProperty('--planning-fade-top',edge.top+'px');
  scroller.style.setProperty('--planning-fade-bottom',edge.bottom+'px');
  scroller.style.setProperty('--planning-scrollbar-size',Math.max(0,scroller.offsetWidth-scroller.clientWidth)+'px');
 }
 const observer=new window.ResizeObserver(update);
 function refresh(){
  scroller?.removeEventListener('scroll',update);observer.disconnect();
  scroller=canvas.querySelector('[data-planning-scroller]');
  scroller?.addEventListener('scroll',update,{passive:true});
  observer.observe(canvas);if(scroller){observer.observe(scroller);for(const child of scroller.children)observer.observe(child)}
  const legend=canvas.querySelector('.planning-month-legend');if(legend)observer.observe(legend);
  update();
 }
 window.addEventListener('resize',update);
 return {refresh};
}
