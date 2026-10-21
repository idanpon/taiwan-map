// Autofill is browser-controlled. Submit only a visible, complete autofilled
// form, once per value pair; never submit ordinary manual typing automatically.
export function installLoginAutofill({form,window=globalThis.window,timers=globalThis}){
 let timer,last='',visible=false;
 const password=form.elements.namedItem('password'),username=form.elements.namedItem('username');
 function check(){
  if(!visible||!form.getClientRects().length||!password.value||(username.required&&!username.value))return;
  let filled=false;try{filled=password.matches(':autofill, :-webkit-autofill')}catch{}
  if(!filled)return;
  const value=username.value+'\0'+password.value;if(value===last||form.querySelector('[type=submit]').disabled)return;
  last=value;form.requestSubmit();
 }
 const schedule=()=>{timers.clearTimeout(timer);timer=timers.setTimeout(check,350)};
 form.addEventListener('input',schedule);form.addEventListener('change',schedule);form.addEventListener('focusin',schedule);
 form.addEventListener('animationstart',event=>{if(event.animationName==='login-autofill')schedule()});
 form.addEventListener('submit',()=>{last=username.value+'\0'+password.value});
 window.addEventListener('pageshow',schedule);
 return {show(){visible=true;last='';schedule()},hide(){visible=false;timers.clearTimeout(timer)}};
}
