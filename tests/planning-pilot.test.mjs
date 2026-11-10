import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDays,listDayGroups,planItemMove,recordCount} from '../public/planning-pilot-model.js';
import {renderPlanningPilot} from '../public/planning-pilot-view.js';
import {sortItems} from '../public/planning-model.js';
import {emptyZonePlan,localPoint} from '../public/trip-timezones.js';

const item=(extra={})=>({id:'record',kind:'task',title:'Запись',state:'open',priority:'normal',sort_order:0,places:[],date_start:'2026-12-29',date_end:null,starts_at:null,ends_at:null,event_timezone:'Europe/Moscow',...extra});
test('day ordering uses priority after manual order and time, before title',()=>{
 const starts_at='2026-12-29T10:00:00Z';
 const rows=[
  item({id:'low',starts_at,priority:'low',title:'Альфа'}),
  item({id:'normal',starts_at,title:'Якорь'}),
  item({id:'high',starts_at,priority:'high',title:'Билет'}),
  item({id:'manual',sort_order:-1,starts_at,priority:'low'}),
  item({id:'critical',starts_at,priority:'critical',title:'Яхта'}),
  item({id:'earlier',starts_at:'2026-12-29T08:00:00Z',priority:'low'}),
  item({id:'untimed',priority:'low'}),
  item({id:'legacy',starts_at,priority:undefined,title:'Музей'})
 ];
 assert.deepEqual(sortItems(rows).map(row=>row.id),[
  'manual','untimed','earlier','critical','high','legacy','normal','low'
 ]);
});
test('today deadline warns only active tasks and decisions, not visits or closed records',()=>{
 const options={view:'list',plan:{users:[],trip:{start_date:'2026-12-29',end_date:'2027-01-09'}},zone:emptyZonePlan,focusDay:'2026-12-29',today:'2026-12-29',now:new Date('2026-12-29T09:00:00Z'),allowed:true};
 const render=extra=>renderPlanningPilot({...options,items:[item(extra)]});
 for(const kind of ['task','decision'])assert.ok(render({kind}).includes('Срок сегодня'));
 for(const extra of [{kind:'visit'},{state:'done'},{state:'cancelled'},{date_start:null},{date_end:'2026-12-30'}])assert.ok(!render(extra).includes('Срок сегодня'));
 assert.ok(render({date_start:'2026-12-28'}).includes('Просрочено'));
 assert.ok(!render({date_start:'2026-12-28',state:'done'}).includes('Просрочено'));
});
test('calendar counts each period once per day and keeps blank weeks out of the selected month',()=>{
 const days=calendarDays('2026-12-30',[item(),item({id:'period',date_start:'2026-12-28',date_end:'2026-12-30'}),item({id:'undated',date_start:null})],emptyZonePlan);
 assert.equal(days.length,35);assert.equal(days.find(day=>day.date==='2026-12-29').items.length,2);assert.equal(days.find(day=>day.date==='2026-12-30').items.length,1);assert.equal(days.find(day=>day.date==='2026-12-31').items.length,0);
});
test('moving a period by a visible continuation shifts the entire period and emits only date fields',()=>{
 const source=item({date_start:'2026-12-29',date_end:'2026-12-31',note:'Keep',state:'in_progress'});
 const {patch}=planItemMove(source,'2027-01-03',emptyZonePlan,'2026-12-30');
 assert.equal(patch.date_start,'2027-01-02');assert.equal(patch.date_end,'2027-01-04');assert.equal('note' in patch,false);assert.equal('state' in patch,false);assert.equal(source.date_start,'2026-12-29');
 assert.equal(planItemMove(source,'2026-12-30',emptyZonePlan,'2026-12-30').unchanged,true);
});
test('undated tasks receive a day and fixed external dates require review',()=>{
 assert.equal(planItemMove(item({date_start:null}),'2027-01-01',emptyZonePlan).patch.date_start,'2027-01-01');
 assert.ok(planItemMove(item({fixed_external:true}),'2027-01-01',emptyZonePlan).review);
 assert.throws(()=>planItemMove(item(),'2027-02-30',emptyZonePlan));
});
test('exact moves preserve local clock time and sub-minute precision across trip zones',()=>{
 const plan={revision:1,changes:[{at:Date.parse('2026-12-29T00:00:00Z'),zone:'Asia/Taipei',region:'Тайвань'}]};
 const source=item({date_start:'2026-12-28',starts_at:'2026-12-28T06:30:15.123Z'});
 const {patch}=planItemMove(source,'2026-12-29',plan);
 assert.equal(patch.starts_at,'2026-12-29T01:30:15.123Z');assert.equal(localPoint(patch.starts_at,plan).time,'09:30');assert.equal(patch.event_timezone,'Asia/Taipei');
});
test('DST gaps, repeated clocks and changing duration open review instead of silently shifting instants',()=>{
 const plan={revision:1,changes:[{at:Date.parse('2027-01-01T00:00:00Z'),zone:'Europe/Berlin',region:''}]};
 for(const [at,target] of [['2027-03-27T01:30:00Z','2027-03-28'],['2027-10-30T00:30:00Z','2027-10-31']])assert.ok(planItemMove(item({starts_at:at}),target,plan).review);
 assert.ok(planItemMove(item({starts_at:'2027-03-26T11:00:00Z',ends_at:'2027-03-27T11:00:00Z',date_end:'2027-03-27'}),'2027-03-27',plan).review);
});
test('list covers every occupied day, exposes empty neighbours and paginates long periods',()=>{
 const result=listDayGroups([item({date_end:'2027-01-02'})],emptyZonePlan,'2026-11-07',2);
 assert.equal(result.hasMore,true);assert.deepEqual(result.groups.filter(day=>day.items.length).map(day=>day.date),['2026-12-29','2026-12-30']);
 assert.ok(result.groups.some(day=>day.date==='2026-11-08'&&!day.items.length));
 const full=listDayGroups([item({date_end:'2027-01-02'})],emptyZonePlan,'2026-11-07');assert.equal(full.hasMore,false);assert.equal(full.groups.filter(day=>day.items.length).length,5);
});
test('the two views preserve ordering, permissions and completion semantics',()=>{
 const rows=[item(),item({id:'undated',date_start:null}),item({id:'choice',kind:'decision'})],options={items:rows,plan:{users:[],trip:{start_date:'2026-12-29',end_date:'2027-01-09'}},zone:emptyZonePlan,focusDay:'2026-12-29',today:'2026-12-29',allowed:true};
 const calendar=renderPlanningPilot({...options,view:'month'});
 assert.ok(calendar.indexOf('planning-selected-day')<calendar.indexOf('planning-undated'));
 assert.match(calendar,/<section class="planning-selected-day" data-drop-day="2026-12-29">/);assert.ok(!calendar.includes('data-quick-complete'));
 const list=renderPlanningPilot({...options,view:'list'});assert.ok(list.includes('data-quick-complete="record"'));assert.ok(!list.includes('data-quick-complete="choice"'));
 const viewer=renderPlanningPilot({...options,allowed:false,view:'list'});assert.ok(!viewer.includes('data-quick-complete'));assert.ok(!viewer.includes('data-drag-item'));
 assert.deepEqual([1,2,5,11,21].map(recordCount),['1 запись','2 записи','5 записей','11 записей','21 запись']);
});

test('the list exposes today as an anchor even outside the first page or without matches',()=>{
 const options={view:'list',plan:{users:[],trip:{start_date:'2026-12-29',end_date:'2027-01-09'}},zone:emptyZonePlan,focusDay:'2026-12-29',today:'2027-01-15',allowed:true,listLimit:1};
 const items=[item(),item({id:'today',title:'Сегодняшняя запись',date_start:options.today})];
 const {groups}=listDayGroups(items,options.zone,options.focusDay,options.listLimit,options.today);
 assert.ok(groups.some(group=>group.date==='2027-01-16'&&!group.items.length));
 const dated=renderPlanningPilot({...options,items});
 assert.match(dated,/<section class="planning-day-group" data-drop-day="2027-01-15" data-list-today>[\s\S]*Сегодняшняя запись/);
 const empty=renderPlanningPilot({...options,items:[],hasFilters:true});
 assert.match(empty,/<section class="planning-day-group" data-drop-day="2027-01-15" data-list-today>[\s\S]*Ничего не нашлось/);
});

test('stays cover nights across months, keep the checkout row and group a hotel change',()=>{
 const stay=(id,start,end,extra={})=>item({id,kind:'stay',date_start:start,date_end:end,
  places:[{role:'lodging',place_id:id,place_name:'Отель '+id}],...extra});
 const hotelA=stay('A','2026-12-30','2027-01-02');
 const hotelB=stay('B','2027-01-02','2027-01-03');
 const overlapping=stay('C','2026-12-31','2027-01-01');
 const cancelled=stay('D','2027-01-03','2027-01-04',{state:'cancelled'});
 const items=[item({id:'task',date_start:'2027-01-02'}),hotelA,hotelB,overlapping,cancelled];
 const plan={items,users:[],trip:{start_date:'2026-12-29',end_date:'2027-01-04'}};
 const render=(focusDay,view='month',visible=items)=>renderPlanningPilot({view,items:visible,plan,zone:emptyZonePlan,
  focusDay,today:'2027-01-02',allowed:true});
 const nights=html=>[...html.matchAll(/data-day="([^"]+)"[^>]*есть проживание на ночь[^>]*>/g)].map(match=>match[1]);
 assert.deepEqual(nights(render('2026-12-31')),['2026-12-30','2026-12-31','2027-01-01','2027-01-02']);
 assert.deepEqual(nights(render('2027-01-03','month',[])),['2026-12-30','2026-12-31','2027-01-01','2027-01-02']);
 assert.match(render('2027-01-03'),/Отель B<[^]*?Выезд/);
 for(const view of ['month','list']){
  const html=render('2027-01-02',view);
  assert.match(html,/planning-stay-transfer[^]*?data-item="A"[^]*?Выезд[^]*?planning-stay-direction[^]*?data-item="B"[^]*?Заселение/);
  assert.ok(html.indexOf('planning-stay-transfer')<html.indexOf('data-item="task"'));
 }
});

test('transport card uses endpoint-local clocks and interleaves timed visits chronologically',()=>{
 const date='2027-01-02',zone={revision:1,changes:[{at:Date.parse('2027-01-01T00:00:00Z'),zone:'Asia/Taipei',region:''}]};
 const ride=item({kind:'transport',id:'ride',title:'Alishan Forest Railway',date_start:date,date_end:date,
  event_timezone:'Asia/Taipei',starts_at:'2027-01-02T02:00:00Z',ends_at:'2027-01-02T06:56:00Z',
  transport:{mode:'train',arrival_timezone:'Asia/Taipei',service_number:'AL-1'},
  places:[{role:'departure',place_name:'Цзяи'},{role:'arrival',place_name:'Алишань'}]});
 const before=item({kind:'visit',id:'before',date_start:date,starts_at:'2027-01-02T01:00:00Z',sort_order:10});
 const after=item({kind:'visit',id:'after',date_start:date,starts_at:'2027-01-02T08:00:00Z',sort_order:-10});
 const items=[after,before,ride];
 const html=renderPlanningPilot({view:'month',items,plan:{items,users:[],trip:{start_date:date,end_date:date}},
  focusDay:date,today:date,zone,allowed:true});
 assert.deepEqual([...html.matchAll(/data-record="([^"]+)"/g)].map(match=>match[1]),['before','ride','after']);
 assert.match(html,/Поезд · Alishan Forest Railway · AL-1/);
 assert.match(html,/Цзяи[^]*?10:00[^]*?Алишань[^]*?14:56/);
});


test('travel cards block quick moves for editors and expose no drag actions to viewers',()=>{
 const day='2027-01-08';
 const items=[item({id:'stay',kind:'stay',date_start:day,date_end:'2027-01-09',places:[{role:'lodging',place_id:'hotel',place_name:'Hotel'}]}),
  item({id:'flight',kind:'transport',date_start:day,date_end:day,transport:{mode:'plane',arrival_timezone:'Asia/Taipei'},places:[{role:'departure',place_name:'A'},{role:'arrival',place_name:'B'}]})];
 const plan={items,users:[],trip:{start_date:day,end_date:'2027-01-09'}};
 for(const view of ['month','list'])for(const allowed of [true,false]){
  const html=renderPlanningPilot({view,items,plan,zone:emptyZonePlan,focusDay:day,today:day,allowed});
  for(const id of ['stay','flight']){
   const card=html.match(new RegExp('<article[^>]*data-record="'+id+'"[^>]*>'))[0];
   assert.equal(card.includes('data-drag-item'),allowed);
   assert.equal(card.includes('data-drag-blocked'),allowed);
  }
 }
});
