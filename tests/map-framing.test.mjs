import test from 'node:test';import assert from 'node:assert/strict';
import {createInitialMapFraming} from '../public/map-framing.js';
test('initial overview waits for both the engine and data, regardless of arrival order',()=>{
 const places=[{lon:120.2,lat:22.6},{lon:121.6,lat:25.1}];
 for(const mapFirst of [true,false]){
  const calls=[],view=createInitialMapFraming({fit:p=>calls.push(p)});
  view.update(mapFirst,mapFirst?[]:places);assert.equal(calls.length,0);
  view.update(true,places);assert.deepEqual(calls,[places]);
 }
});
test('initial framing does not reset the view on refresh, filter or theme renders, including after an empty catalog',()=>{
 const calls=[],view=createInitialMapFraming({fit:p=>calls.push(p)}),places=[{id:'all'}];
 view.update(true,[]);view.update(true,places);view.update(true,[{id:'filtered'}]);view.update(true,places);assert.deepEqual(calls,[places]);
});
test('an explicit focus, fit or location before readiness overrides automatic framing',()=>{
 const calls=[],view=createInitialMapFraming({fit:p=>calls.push(p)});
 view.update(false,[{id:'p'}]);view.cancel();view.update(true,[{id:'p'}]);assert.equal(calls.length,0);
});
