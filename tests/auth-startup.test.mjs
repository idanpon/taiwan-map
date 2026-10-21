import test from 'node:test';import assert from 'node:assert/strict';
import {createAuthStartup,createLoadingScreenUI} from '../public/auth-startup.js';
import {page} from '../src/ui.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
test('startup waits for config and session before showing login; an authenticated session never exposes a login form',async()=>{
 for(const loggedIn of [true,false]){
  const config=deferred(),session=deferred(),events=[];
  const ui=createAuthStartup({initialize:()=>config.promise,load:()=>{events.push('session');return session.promise},onLoading:()=>events.push('loading'),onLogin:()=>events.push('login'),onError:e=>events.push(e)});
  const first=ui.run();assert.equal(ui.run(),first);assert.deepEqual(events,['loading']);await flush();config.resolve();await flush();assert.deepEqual(events,['loading','session']);
  if(loggedIn)session.resolve();else session.reject(Object.assign(new Error('Unauthorized'),{status:401}));
  await first;assert.deepEqual(events,loggedIn?['loading','session']:['loading','session','login']);assert.equal(ui.running,false);
 }
});
test('config failure or timeout shows a retryable loading error, never legacy login, and retry can succeed',async()=>{
 let expired,fail=true;const events=[],timers={setTimeout(fn){expired=fn;return 1},clearTimeout(){}};
 const ui=createAuthStartup({timers,initialize:signal=>fail?new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Aborted')))):Promise.resolve(),load:async()=>{},onLoading:()=>events.push('loading'),onLogin:()=>events.push('login'),onError:e=>events.push(e)});
 const attempt=ui.run();await flush();expired();await attempt;assert.match(events.at(-1),/не ответил вовремя/);assert.ok(!events.includes('login'));
 fail=false;await ui.run();assert.equal(events.at(-1),'loading');assert.equal(ui.running,false);
});
test('initial HTML gates the form, uses a neutral loading state and provides focus targets and theme action buttons',()=>{
 assert.match(page,/<div id="auth-content" hidden>/);assert.match(page,/id="auth-loading"[^>]*role="status"/);assert.ok(!page.includes('Пароль к поездке'));
 assert.ok(page.includes('<title>Тайвань · Карта поездки</title>'));assert.equal((page.match(/data-theme-toggle/g)||[]).length,2);assert.ok(!page.includes('data-theme-select'));
 for(const id of ['help-title','account-title','statuses-title','hidden-places-title'])assert.match(page,new RegExp('id="'+id+'"[^>]*tabindex="-1"[^>]*autofocus'));
});

test('an unauthorized config response cannot reveal an unconfigured login form',async()=>{
 const events=[];const ui=createAuthStartup({initialize:async()=>{throw Object.assign(new Error('Config unavailable'),{status:401})},load:async()=>events.push('session'),onLoading:()=>events.push('loading'),onLogin:()=>events.push('login'),onError:e=>events.push(e)});
 await ui.run();assert.deepEqual(events,['loading','Config unavailable']);
});

test('shared loading screen stops on failure and retry restores the page-specific message without revealing login',()=>{
 const elements=Object.fromEntries(['login','auth-content','auth-loading','auth-loading-message','auth-retry'].map(id=>[id,{hidden:false,dataset:{},textContent:''}]));
 for(const message of ['Загружаем карту…','Загружаем календарь…']){
  const screen=createLoadingScreenUI({$:id=>elements[id],message});screen.show();
  assert.equal(elements['auth-content'].hidden,true);assert.equal(elements['auth-retry'].hidden,true);
  screen.error('Сервер недоступен');assert.equal(elements['auth-loading'].dataset.state,'error');assert.equal(elements['auth-retry'].hidden,false);
  screen.show();assert.equal(elements['auth-loading'].dataset.state,'loading');assert.equal(elements['auth-loading-message'].textContent,message);assert.equal(elements['auth-retry'].hidden,true);assert.equal(elements['auth-content'].hidden,true);
 }
});
