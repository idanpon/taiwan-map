import test from 'node:test';
import assert from 'node:assert/strict';
import {routeFixture} from './route-ui-fixture.mjs';
import {routeUIScenario} from './route-ui-scenario.mjs';
import {routeHtml} from '../public/route-planning-view.js';
import {detail} from '../public/route-planning-details.js';
import {viewedModel,calendarFacts,preparationRows,slotInput,instantInput,commandVersionTarget} from '../public/route-planning-model.js';
import {createItemCommands,serviceInput} from '../public/route-planning-forms.js';
import {planningPlaceSummary} from '../public/planning-links.js';
import {escapeHtml} from '../public/client-runtime.js';
test('real route cards derive readiness, calendar nights and comparison without changing preparation or facts',async t=>{
 const f=await routeFixture(t),ids=routeUIScenario(f),m=f.model(),before=JSON.stringify(m.sources);
 assert.equal(calendarFacts(m,'2035-01-06').housing,true);
 const view=viewedModel(m,{[ids.decision.decision]:ids.early.option});
 assert.equal(calendarFacts(view,'2035-01-06').housing,false);
 assert.match(detail(view,'placement',ids.alternative.placement,true).html,/Нужна проверка/);
 assert.equal(JSON.stringify(m.sources),before);
 for(const d of ['month','list']){const html=routeHtml(m,{view:d,focusDay:'2035-01-04',state:'active',choices:{[ids.decision.decision]:ids.early.option},allowed:true});assert.match(html,/Просмотр альтернативы/);assert.match(html,/Всё готово/);assert.match(html,/route-option-viewport/);assert.doesNotMatch(html,/data-route-swipe="undefined"/);}
 const card=detail(m,'placement',ids.tower.placement,true);assert.match(card.html,/Закреплено/);assert.match(card.html,/Билет \/ бронь/);
 assert.equal(card.reminder.id,ids.tower.item);
 assert.equal(detail(view,'placement',ids.alternative.placement,true).reminder,null);
 assert.match(detail(m,'placement',ids.hotel.placement,true).html,/Закреплено/);
 for(const [type,id] of [['item',ids.hotelTask.item],['need',ids.hotelNeed.need],['booking',ids.hotelBooking.booking],['service',ids.hotelService.service],['decision',ids.decision.decision],['option',ids.early.option],['deadline',ids.cancelDeadline.link]])assert.doesNotThrow(()=>detail(m,type,id,true));
 assert.doesNotMatch(detail(m,'placement',ids.tower.placement,false).html,/data-route-action="edit-slot"/);
 assert.equal(preparationRows(m,{state:'active'}).length,1);assert.equal(preparationRows(m,{mode:'linked_day',day:'2035-01-05',state:'active'}).length,1);assert.equal(preparationRows(m,{mode:'scheduled_day',day:'2035-01-05',state:'active'}).length,0);
 assert.match(planningPlaceSummary(m,'taipei-101',escapeHtml),/#placement=/);
});
test('form commands preserve metadata, exact zones and reject DST ambiguity; route completion stays separate from task completion',async t=>{
 const f=await routeFixture(t);const commands=createItemCommands({kind:'visit',title:'New',description:'description',note:'private note',priority:'normal',precision:'exact',starts_at:'2035-01-04T16:00',ends_at:'2035-01-04T17:00',start_timezone:'Asia/Taipei',end_timezone:'Asia/Taipei'});
 const ids=f.write(commands);assert.equal(f.row('placements',ids.new.placement).starts_at,'2035-01-04T08:00:00.000Z');assert.equal(f.row('items',ids.new.item).note,'private note');
 f.write([f.change('items',ids.new.item,'set_route_state',{state:'done'})]);assert.equal(f.row('items',ids.new.item).state,'done');
 assert.throws(()=>instantInput('2030-11-03T01:30','America/New_York'),/дважды/);
 assert.equal(slotInput({precision:'unscheduled'}).starts_at,null);
 const service=serviceInput({kind:'admission',state:'confirmed',title:'Ticket',validity:'exact_start',starts_at:'2035-01-04T16:00',start_timezone:'Asia/Taipei',end_timezone:'Asia/Taipei',unit_type:'person',capacity_units:'2',cancellation_policy:'allowed',change_policy:'unknown',terms_notes:'Keep conditions'});
 f.write([{key:'booking',type:'record_booking',data:{category:'activity'}},{key:'service',type:'add_service',booking_id:{command:'booking',entity:'booking'},data:service}]);
});
test('refresh resolves decision versions separately from item versions and supports indirect edit targets',async t=>{
 const f=await routeFixture(t),ids=routeUIScenario(f),s=f.model().sources;
 assert.deepEqual(commandVersionTarget({type:'choose_working',id:ids.decision.decision,expected_version:1},s),{collection:'decisions',id:ids.decision.decision});
 assert.deepEqual(commandVersionTarget({type:'edit_item',id:ids.decision.decision,expected_version:1},s),{collection:'items',id:ids.decision.decision});
 assert.deepEqual(commandVersionTarget({type:'ensure_preparation',need_id:ids.ticketNeed.need,expected_version:1},s),{collection:'needs',id:ids.ticketNeed.need});
 assert.deepEqual(commandVersionTarget({type:'add_option',decision_id:ids.decision.decision,expected_version:1},s),{collection:'decisions',id:ids.decision.decision});
 assert.equal(commandVersionTarget({type:'upsert_placement',id:{command:'new',entity:'placement'},expected_version:1},s),null);
 assert.equal(commandVersionTarget({type:'edit_need',id:'same',expected_version:1},{items:[{id:'same'}],needs:[{id:'same'}]}),null);
});
test('changing service time mode clears hidden old bounds and holding date',()=>{
 const values={kind:'stay',title:'Hotel',state:'confirmed',validity:'date_range',starts_at:'2035-01-04T12:00',ends_at:'2035-01-07T12:00',date_start:'2035-02-01',date_end:'2035-02-04',hold_expires:'2034-12-31T12:00',start_timezone:'Asia/Taipei',end_timezone:'Asia/Taipei',unit_type:'room'};
 const service=serviceInput(values);assert.equal(service.starts_at,null);assert.equal(service.ends_at,null);assert.equal(service.date_start,'2035-02-01');assert.equal(service.hold_expires_at,null);
});
