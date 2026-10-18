export function createCompassControl({map,button}){
 let disposed=false;
 function update(){
  if(disposed)return;
  const raw=map.getBearing(),bearing=Number.isFinite(raw)?((raw+180)%360+360)%360-180:0;
  // Ignore floating-point drift around north, including a complete turn.
  button.hidden=Math.abs(bearing)<=0.1;
  button.style.setProperty('--north-bearing',`${-bearing}deg`);
  if(button.hidden&&button.ownerDocument.activeElement===button)map.getCanvas().focus({preventScroll:true});
 }
 function reset(){if(!disposed&&!button.hidden&&!button.disabled)map.resetNorth({duration:300})}
 button.disabled=false;button.addEventListener('click',reset);map.on('rotate',update);update();
 return {dispose(){if(disposed)return;disposed=true;map.off('rotate',update);button.removeEventListener('click',reset);button.hidden=true;button.disabled=true}};
}
