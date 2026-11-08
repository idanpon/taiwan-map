// The desktop keeps scrolling inside each view; the phone uses the page.
export function planningScrollArea(element,window){
 const area=element?.closest?.('[data-planning-scroller]');
 return area&&/auto|scroll/.test(window.getComputedStyle(area).overflowY)?area:null;
}
export function scrollPlanningBy(area,delta,window){
 if(area)area.scrollTop+=delta;else window.scrollBy(0,delta);
}
export function planningScrollBounds(area,window){
 if(!area)return {top:100,bottom:window.innerHeight-64};
 const box=area.getBoundingClientRect();
 return {top:Math.max(0,box.top)+40,bottom:Math.min(window.innerHeight,box.bottom)-40};
}
