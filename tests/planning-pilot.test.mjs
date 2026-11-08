import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDays,listDayGroups,planItemMove,recordCount} from '../public/planning-pilot-model.js';
import {renderPlanningPilot} from '../public/planning-pilot-view.js';
import {emptyZonePlan,localPoint} from '../public/trip-timezones.js';

const item=(extra={})=>({id:'record',kind:'task',title:'Запись',state:'open',priority:'normal',sort_order:0,places:[],date_start:'2026-12-29',date_end:null,starts_at:null,ends_at:null,event_timezone:'Europe/Moscow',...extra});
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
