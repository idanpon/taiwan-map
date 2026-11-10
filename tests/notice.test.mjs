import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotice} from '../public/notice.js';

test('date warning expires with its action, pausing on focus and replacing its timer',t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const handlers={},message={};
 let focused=false,opens=0;
 const button={matches:()=>focused,addEventListener:(name,fn)=>{handlers[name]=fn}};
 const element={hidden:true,dataset:{},querySelector:selector=>selector==='.ui-notice-action'?button:message};
 const notice=createNotice(element);
 const warning={timeout:8000,action:{label:'Изменить даты',run:()=>opens++}};
 notice.show('Измените даты',warning);
 t.mock.timers.tick(3000);
 focused=true;handlers.focus();
 t.mock.timers.tick(10000);
 assert.equal(element.hidden,false);
 button.onclick();
 assert.equal(opens,1);
 focused=false;handlers.blur();
 t.mock.timers.tick(4999);
 assert.equal(element.hidden,false);
 t.mock.timers.tick(1);
 assert.equal(element.hidden,true);
 button.onclick();
 assert.equal(opens,1);

 notice.show('Измените даты',warning);
 t.mock.timers.tick(7999);
 notice.show('Запись перенесена',{action:{label:'Отменить',run:()=>opens++}});
 t.mock.timers.tick(10000);
 assert.equal(element.hidden,false);
 button.onclick();
 assert.equal(opens,2);
 notice.show('Обычное уведомление');
 t.mock.timers.tick(6500);
 assert.equal(element.hidden,true);
});
