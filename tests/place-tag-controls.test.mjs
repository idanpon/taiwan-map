import test from 'node:test';import assert from 'node:assert/strict';
import {createPlaceTagControls,tagsPatch,tagEditorContent} from '../public/place-tag-controls.js';
import {emptyTags,mergeTags} from '../public/place-tags.js';
function fixture(save){
 const fields=new Map(),sets=new Map(),messages=[],calls=[],dirty=[],busy=[];let changes=0;
 for(const name of ['photoSpot','limitedDates','reservation','startDate','endDate','scheduleText','bookingUrl'])fields.set(name,{value:'',checked:false,disabled:false,closest:()=>({classList:{toggle(){}}})});
 for(const name of ['limitedDates','reservation'])sets.set(name,{hidden:true,disabled:true});
 const button={disabled:true};const form={elements:{namedItem:name=>fields.get(name)},querySelector:selector=>selector==='[type=submit]'?button:sets.get(selector.match(/"([^"]+)"/)[1]),querySelectorAll:()=>[...fields.values(),button]};
 const place={id:'p',tags_version:1,tags:emptyTags()};
 const ui=createPlaceTagControls({root:{innerHTML:'',querySelector:()=>form},place,esc:String,toast:x=>messages.push(x),onDirty:x=>dirty.push(x),onBusy:x=>busy.push(x),onChange:()=>changes++,api:async(path,options)=>{calls.push({path,body:options?JSON.parse(options.body):null});return save?save(path,options,place):{tags:mergeTags(place.tags,JSON.parse(options.body).tags),tags_version:place.tags_version+1}}});
 return {fields,sets,place,ui,form,button,messages,calls,dirty,busy,get changes(){return changes},input(){form.oninput()},submit(){return form.onsubmit({preventDefault(){}})}};
}
test('tag editor switches expose only relevant fields and retain disabled values without sending unrelated fields',async()=>{
 const f=fixture();assert.equal(f.button.disabled,true);assert.equal(f.sets.get('limitedDates').hidden,true);
 f.fields.get('limitedDates').checked=true;f.input();assert.equal(f.sets.get('limitedDates').hidden,false);f.fields.get('scheduleText').value='Line 1\nLine 2';await f.submit();
 assert.deepEqual(f.calls[0].body,{version:1,tags:{limitedDates:{enabled:true,scheduleText:'Line 1\nLine 2'}}});assert.equal(f.place.tags_version,2);assert.equal(f.button.disabled,true);
 f.fields.get('limitedDates').checked=false;f.input();assert.equal(f.sets.get('limitedDates').hidden,true);assert.equal(f.fields.get('scheduleText').value,'Line 1\nLine 2');await f.submit();assert.deepEqual(f.calls[1].body.tags,{limitedDates:{enabled:false}});
 f.fields.get('limitedDates').checked=true;f.input();assert.equal(f.fields.get('scheduleText').value,'Line 1\nLine 2');assert.equal(f.dirty.at(-1),true);
});
test('tag failures keep the draft, refresh versions on conflict and send only explicitly changed fields on retry',async()=>{
 let first=true;const f=fixture(async(path,options,p)=>{
  if(path==='/api/data')return {places:[{...p,tags:mergeTags(p.tags,{reservation:{enabled:true,url:'https://example.com'}}),tags_version:2}]};
  if(first){first=false;throw Object.assign(new Error('Conflict'),{status:409})}
  return {tags:mergeTags(p.tags,JSON.parse(options.body).tags),tags_version:3};
 });
 f.fields.get('photoSpot').checked=true;f.input();await f.submit();assert.equal(f.fields.get('photoSpot').checked,true);assert.equal(f.place.tags_version,2);assert.equal(f.dirty.at(-1),true);assert.equal(f.busy.at(-1),false);
 await f.submit();assert.deepEqual(f.calls[2].body,{version:2,tags:{photoSpot:true}});assert.equal(f.place.tags.reservation.enabled,true);assert.equal(f.place.tags.reservation.url,'https://example.com');assert.equal(f.fields.get('reservation').checked,true);assert.equal(f.dirty.at(-1),false);
});
test('validation prevents invalid booking/dates from saving and in-flight requests lock the form',async()=>{
 let finish;const f=fixture(()=>new Promise(resolve=>finish=resolve));
 f.fields.get('reservation').checked=true;f.fields.get('bookingUrl').value='javascript:alert(1)';f.input();await f.submit();assert.equal(f.calls.length,0);assert.match(f.messages.at(-1),/HTTP/);
 f.fields.get('bookingUrl').value='https://example.com';const pending=f.submit();assert.equal(f.button.disabled,true);assert.equal(f.fields.get('photoSpot').disabled,true);await f.submit();assert.equal(f.calls.length,1);finish({tags:mergeTags(undefined,{reservation:{enabled:true,url:'https://example.com'}}),tags_version:2});await pending;assert.equal(f.fields.get('photoSpot').disabled,false);
});
test('snapshot restores independent tag drafts after a note conflict without losing their baseline',()=>{
 const f=fixture();f.fields.get('limitedDates').checked=true;f.fields.get('endDate').value='2027-01-05';f.input();const snapshot=f.ui.snapshot();const next=fixture();next.ui.restore(snapshot);assert.equal(next.fields.get('endDate').value,'2027-01-05');assert.equal(next.dirty.at(-1),true);
 assert.deepEqual(tagsPatch(emptyTags(),snapshot.draft),{limitedDates:{enabled:true,endDate:'2027-01-05'}});
 const html=tagEditorContent(String);assert.equal((html.match(/type="checkbox"/g)||[]).length,3);assert.ok(!html.includes('emoji'));
});
