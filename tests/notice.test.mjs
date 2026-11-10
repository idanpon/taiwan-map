import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotice} from '../public/notice.js';

function fixture(t){
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const handlers={},message={},styles=new Map();
 let focused=false;
 const button={};
 const element={
  hidden:true,dataset:{},style:{setProperty:(key,value)=>styles.set(key,value)},
  querySelector:selector=>selector==='.ui-notice-action'?button:message,
  matches:selector=>selector===':focus-within'&&focused,
  addEventListener:(name,fn)=>{handlers[name]=fn},
  append(){},
 };
 const notice=createNotice(element);
 return {
  notice,element,button,message,styles,
  focus(){focused=true;handlers.focusin()},
  blur(){focused=false;handlers.focusout()},
  swipe(dx,dy=0){
   const start={identifier:0,clientX:100,clientY:100};
   const end={...start,clientX:100+dx,clientY:100+dy};
   handlers.touchstart({touches:[start],timeStamp:0});
   handlers.touchmove({touches:[end],timeStamp:100});
   handlers.touchend({changedTouches:[end],timeStamp:110});
  },
  fading:()=>Object.hasOwn(element.dataset,'fading')
 };
}

test('plain, warning and undo notices all fade at six seconds and close at 6.5 seconds',t=>{
 const {notice,element,button,styles,fading}=fixture(t);
 let clicks=0;
 for(const [tone,label] of [['neutral',null],['warning','Изменить даты'],['neutral','Отменить']]){
  const before=clicks;
  notice.show('Сообщение',{tone,action:label?{label,run:()=>clicks++}:undefined});
  t.mock.timers.tick(5999);
  assert.equal(element.hidden,false);
  assert.equal(fading(),false);
  t.mock.timers.tick(1);
  assert.equal(fading(),true);
  assert.equal(styles.get('--ui-notice-fade-duration'),'500ms');
  t.mock.timers.tick(499);
  assert.equal(element.hidden,false);
  button.onclick();
  assert.equal(clicks,before+(label?1:0));
  t.mock.timers.tick(1);
  assert.equal(element.hidden,true);
  assert.equal(fading(),false);
  button.onclick();
  assert.equal(clicks,before+(label?1:0));
 }
});

test('horizontal swipes dismiss in both directions and retire a pending rating notice',t=>{
 const {notice,element,swipe}=fixture(t);
 for(const dx of [-72,72]){
  const content={remove(){this.removed=true}};
  const shown=notice.show('1 из 2 · Оценить место',{content});
  shown.setWaiting(true);
  t.mock.timers.tick(7000);
  assert.equal(shown.active,true);
  swipe(3,75);
  assert.equal(element.hidden,false);
  swipe(dx);
  assert.equal(shown.active,false);
  assert.equal(content.removed,true);
  assert.equal(element.hidden,true);
  shown.setWaiting(false);
  t.mock.timers.tick(7000);
  assert.equal(element.hidden,true);
 }
});

test('a replacement after a pending rating gets the full notice duration',t=>{
 const {notice,element}=fixture(t);
 const first=notice.show('1 из 2');
 t.mock.timers.tick(6300);
 first.setWaiting(true);
 t.mock.timers.tick(1000);
 const second=notice.show('2 из 2');
 first.dismiss();
 first.setWaiting(false);
 t.mock.timers.tick(6499);
 assert.equal(second.active,true);
 t.mock.timers.tick(1);
 assert.equal(second.active,false);
 assert.equal(element.hidden,true);
});

test('focusing a fading action restores visibility and pauses the remaining time',t=>{
 const {notice,element,button,focus,blur,styles,fading}=fixture(t);
 let opens=0;
 notice.show('Измените даты',{action:{label:'Изменить даты',run:()=>opens++}});
 t.mock.timers.tick(6100);
 assert.equal(fading(),true);
 focus();
 t.mock.timers.tick(10000);
 assert.equal(element.hidden,false);
 assert.equal(fading(),false);
 button.onclick();
 assert.equal(opens,1);
 blur();
 assert.equal(fading(),true);
 assert.equal(styles.get('--ui-notice-fade-duration'),'400ms');
 t.mock.timers.tick(399);
 assert.equal(element.hidden,false);
 t.mock.timers.tick(1);
 assert.equal(element.hidden,true);
});

test('replacing a fading notice starts fresh and clears the previous action and timers',t=>{
 const {notice,element,button,message,fading}=fixture(t);
 notice.show('Измените даты',{action:{label:'Изменить даты',run:()=>assert.fail('Stale action')}});
 t.mock.timers.tick(6200);
 notice.show('Запись сохранена');
 assert.equal(message.textContent,'Запись сохранена');
 assert.equal(fading(),false);
 button.onclick();
 t.mock.timers.tick(5999);
 assert.equal(element.hidden,false);
 assert.equal(fading(),false);
 t.mock.timers.tick(1);
 assert.equal(fading(),true);
 t.mock.timers.tick(500);
 assert.equal(element.hidden,true);
});
