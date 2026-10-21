import test from 'node:test';import assert from 'node:assert/strict';
import {installLoginAutofill} from '../public/login-autofill.js';
test('autofill submits complete visible fields once; manual typing, hidden login, failed retries and busy form never auto-submit',()=>{
 const handlers={},timers={setTimeout(fn){this.next=fn;return 1},clearTimeout(){this.next=null}},button={disabled:false};let submitted=0,filled=false,shown=true;
 const form={elements:{namedItem:name=>name==='password'?password:username},getClientRects:()=>shown?[{}]:[],querySelector:()=>button,addEventListener:(name,fn)=>handlers[name]=fn,requestSubmit(){submitted++;handlers.submit()}},password={value:'',matches:()=>filled},username={value:'',required:true};
 const ui=installLoginAutofill({form,window:{addEventListener(){}},timers});const tick=()=>{const next=timers.next;timers.next=null;next?.()};
 ui.show();password.value='test';username.value='user';tick();assert.equal(submitted,0);
 filled=true;handlers.input();tick();assert.equal(submitted,1);handlers.change();tick();assert.equal(submitted,1);
 password.value='changed';button.disabled=true;handlers.input();tick();assert.equal(submitted,1);button.disabled=false;handlers.change();tick();assert.equal(submitted,2);
 ui.hide();password.value='hidden';handlers.change();tick();assert.equal(submitted,2);
 shown=false;ui.show();tick();assert.equal(submitted,2);shown=true;username.value='';handlers.input();tick();assert.equal(submitted,2);
});
