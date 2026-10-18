import test from 'node:test';import assert from 'node:assert/strict';
import {createPlaceTagControls,tagsPatch,tagEditorContent} from '../public/place-tag-controls.js';
import {emptyTags,mergeTags} from '../public/place-tags.js';
function fixture(){
 const fields=new Map(),sets=new Map(),dirty=[],schedule={open:false};
 for(const name of ['photoSpot','limitedDates','reservation','startDate','endDate','scheduleText','bookingUrl'])fields.set(name,{value:'',checked:false,disabled:false,closest:()=>({classList:{toggle(){}}})});
 for(const name of ['limitedDates','reservation'])sets.set(name,{hidden:true,disabled:true});
 const root={innerHTML:'',querySelector(selector){if(selector==='.schedule-editor')return schedule;if(selector.startsWith('[name='))return fields.get(selector.match(/"([^"]+)"/)[1]);return sets.get(selector.match(/"([^"]+)"/)[1])},querySelectorAll:()=>[...fields.values()]};
 const place={id:'p',tags_version:1,tags:emptyTags()};
 const ui=createPlaceTagControls({root,place,esc:String,onDirty:x=>dirty.push(x)});
 return {fields,sets,place,ui,root,dirty,schedule,input(){root.oninput()}};
}
test('tag fields use the parent Save form, with the schedule collapsed by default and no separate submit',()=>{
 const html=tagEditorContent(String);assert.ok(!html.includes('<form'));assert.ok(!html.includes('type="submit"'));assert.match(html,/<details class="schedule-editor">/);assert.ok(!html.includes('<details open'));
 const f=fixture();assert.equal(f.schedule.open,false);assert.equal(f.sets.get('limitedDates').hidden,true);f.fields.get('limitedDates').checked=true;f.input();assert.equal(f.sets.get('limitedDates').hidden,false);
});
test('conditional fields retain values and their minimal patch until the common save commits them',()=>{
 const f=fixture();f.fields.get('limitedDates').checked=true;f.fields.get('scheduleText').value='Line 1\nLine 2';f.input();
 assert.deepEqual(f.ui.patch(),{limitedDates:{enabled:true,scheduleText:'Line 1\nLine 2'}});assert.equal(f.dirty.at(-1),true);
 const saved=mergeTags(undefined,f.ui.patch());f.ui.commit(saved);assert.equal(f.dirty.at(-1),false);assert.deepEqual(f.ui.patch(),{});
 f.fields.get('limitedDates').checked=false;f.input();assert.equal(f.sets.get('limitedDates').hidden,true);assert.equal(f.fields.get('scheduleText').value,'Line 1\nLine 2');assert.deepEqual(f.ui.patch(),{limitedDates:{enabled:false}});
});
test('field validation prevents the common save from submitting invalid dates or booking links; busy state locks only active fields',()=>{
 const f=fixture();f.fields.get('reservation').checked=true;f.fields.get('bookingUrl').value='javascript:alert(1)';f.input();assert.throws(()=>f.ui.patch(),/HTTP/);
 f.fields.get('bookingUrl').value='https://example.com';f.ui.setBusy(true);assert.ok([...f.fields.values()].every(x=>x.disabled));f.ui.setBusy(false);assert.equal(f.fields.get('photoSpot').disabled,false);assert.equal(f.sets.get('limitedDates').disabled,true);assert.equal(f.sets.get('reservation').disabled,false);
});
test('a combined-save conflict can restore every tag draft and the schedule disclosure without changing the patch baseline',()=>{
 const f=fixture();f.fields.get('limitedDates').checked=true;f.fields.get('endDate').value='2027-01-05';f.fields.get('scheduleText').value='Keep this text';f.schedule.open=true;f.input();
 const snapshot=f.ui.snapshot(),next=fixture();next.ui.restore(snapshot);assert.equal(next.fields.get('endDate').value,'2027-01-05');assert.equal(next.fields.get('scheduleText').value,'Keep this text');assert.equal(next.schedule.open,true);assert.equal(next.dirty.at(-1),true);
 assert.deepEqual(tagsPatch(emptyTags(),snapshot.draft),next.ui.patch());
});
