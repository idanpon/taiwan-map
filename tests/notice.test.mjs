import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotice} from '../public/notice.js';

function fixture(t){
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const handlers={},message={},styles=new Map();
 let focused=false;
 const button={matches:()=>focused,addEventListener:(name,fn)=>{handlers[name]=fn}};
 const element={hidden:true,dataset:{},style:{setProperty:(key,value)=>styles.set(key,value)},querySelector:selector=>selector==='.ui-notice-action'?button:message};
 const notice=createNotice(element);
 return {
  notice,element,button,message,styles,
  focus(){focused=true;handlers.focus()},
  blur(){focused=false;handlers.blur()},
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
