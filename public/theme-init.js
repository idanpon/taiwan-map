// Blocking head script: choose colors and loader geometry before the first paint.
(() => {
 let saved;try{saved=localStorage.getItem('taiwan-map-theme')}catch{}
 const theme=['light','dark'].includes(saved)?saved:(window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light');
 document.documentElement.dataset.theme=theme;
 document.documentElement.style.colorScheme=theme;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#17212d':'#f4f5f7');
})();

// A standalone iOS window can report different layout and visible heights.
// Only the loading overlay consumes these values; page/map geometry is untouched.
(() => {
 const root=document.documentElement,viewport=window.visualViewport;
 function sync(){
  if(viewport?.scale&&viewport.scale!==1)return;
  const heights=[window.innerHeight,viewport?.height].filter(value=>Number.isFinite(value)&&value>0);
  if(!heights.length)return;
  root.style.setProperty('--loading-viewport-height',Math.min(...heights)+'px');
  root.style.setProperty('--loading-viewport-top',Math.max(0,viewport?.offsetTop||0)+'px');
 }
 sync();window.addEventListener?.('resize',sync);window.addEventListener?.('pageshow',sync);
 viewport?.addEventListener?.('resize',sync);viewport?.addEventListener?.('scroll',sync);
})();
