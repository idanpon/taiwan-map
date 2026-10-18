// Blocking head script: choose colors before any stylesheet or body is painted.
(() => {
 let saved;try{saved=localStorage.getItem('taiwan-map-theme')}catch{}
 const theme=['light','dark'].includes(saved)?saved:(window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light');
 document.documentElement.dataset.theme=theme;
 document.documentElement.style.colorScheme=theme;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#17212d':'#f4f5f7');
})();
