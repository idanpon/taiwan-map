export function createThemeUI({document,window,onChange}){
 const key='taiwan-map-theme',media=window.matchMedia('(prefers-color-scheme: dark)');
 let manual=false;try{manual=['light','dark'].includes(window.localStorage.getItem(key))}catch{}
 let theme=document.documentElement.dataset.theme==='dark'?'dark':'light';
 const controls=[...document.querySelectorAll('[data-theme-toggle]')];
 function sync(){
  const target=theme==='dark'?'светлую':'тёмную',label='Включить '+target+' тему';
  for(const control of controls){control.setAttribute('aria-label',label);control.setAttribute('title',label)}
 }
 function apply(value){
  theme=value;document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#17212d':'#f4f5f7');
  sync();onChange(theme);
 }
 for(const control of controls)control.addEventListener('click',()=>{
  const next=theme==='dark'?'light':'dark';manual=true;
  try{window.localStorage.setItem(key,next)}catch{}
  apply(next);
 });
 sync();
 media.addEventListener('change',event=>{if(!manual)apply(event.matches?'dark':'light')});
 window.addEventListener('storage',event=>{if(event.key!==key)return;manual=['light','dark'].includes(event.newValue);apply(manual?event.newValue:media.matches?'dark':'light')});
 return {get value(){return theme}};
}
