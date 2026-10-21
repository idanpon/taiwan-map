import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
import {createThemeUI} from '../public/theme.js';
import {statusAppearance} from '../public/map-model.js';
function fixture(saved,system=false,storageFails=false){
 const events={},media={matches:system,addEventListener(type,fn){this.change=fn}},controls=[0,1].map(()=>({attributes:{},setAttribute(k,v){this.attributes[k]=v},addEventListener(type,fn){this[type]=fn}}));
 let stored=saved;const root={dataset:{},style:{}},meta={setAttribute(key,value){this[key]=value}};
 const document={documentElement:root,querySelector:()=>meta,querySelectorAll:()=>controls};
 const window={matchMedia:()=>media,addEventListener:(type,fn)=>events[type]=fn,localStorage:{getItem(){if(storageFails)throw new Error('Denied');return stored},setItem(k,v){if(storageFails)throw new Error('Denied');stored=v}}};
 return {window,document,controls,media,events,root,meta,get saved(){return stored}};
}
test('blocking bootstrap applies saved or system theme before page rendering, even if browser storage is blocked',async()=>{
 const source=await readFile('public/theme-init.js','utf8');
 for(const [saved,system,expected,blocked] of [[null,true,'dark',false],['light',true,'light',false],['bad',false,'light',false],[null,true,'dark',true]]){
  const f=fixture(saved,system,blocked);vm.runInNewContext(source,{document:f.document,window:f.window,localStorage:f.window.localStorage});
  assert.equal(f.root.dataset.theme,expected);assert.equal(f.root.style.colorScheme,expected);assert.equal(f.meta.content,expected==='dark'?'#17212d':'#f4f5f7');
 }
});
test('both visible theme controls stay in sync, manual choice survives system changes, and blocked storage does not break switching',()=>{
 for(const blocked of [false,true]){
  const f=fixture(null,false,blocked);f.root.dataset.theme='light';const changes=[];const ui=createThemeUI({...f,onChange:x=>changes.push(x)});
  f.media.change({matches:true});assert.equal(ui.value,'dark');assert.ok(f.controls.every(x=>x.attributes['aria-label']==='Включить светлую тему'));
  f.controls[1].click();assert.equal(ui.value,'light');f.media.change({matches:true});assert.equal(ui.value,'light');assert.equal(f.controls[0].attributes['aria-label'],'Включить тёмную тему');
  if(!blocked)assert.equal(f.saved,'light');assert.equal(changes.at(-1),'light');
  f.events.storage({key:'taiwan-map-theme',newValue:'dark'});assert.equal(ui.value,'dark');
 }
});
test('themes preserve status color, symbol and opacity while keeping labels legible',()=>{
 for(const color of ['#facc15','#1456e0','#dc2626','#6b7280'])for(const theme of ['light','dark']){
  const value=statusAppearance({color,symbol:'✓',dimmed:true},theme);assert.equal(value.color,color);assert.equal(value.symbol,'✓');assert.equal(value.opacity,0.7);assert.match(value.textColor,/^#[0-9a-f]{6}$/i);
 }
});
test('loader follows the visible viewport before paint and on standalone resize, without following pinch zoom',async()=>{
 const source=await readFile('public/theme-init.js','utf8'),f=fixture(null,false),properties={},events={};
 f.root.style.setProperty=(name,value)=>properties[name]=value;
 f.window.innerHeight=900;f.window.visualViewport={height:780,offsetTop:20,scale:1,addEventListener:(type,fn)=>events[type]=fn};
 vm.runInNewContext(source,{document:f.document,window:f.window,localStorage:f.window.localStorage});
 assert.equal(properties['--loading-viewport-height'],'780px');assert.equal(properties['--loading-viewport-top'],'20px');
 f.window.innerHeight=844;Object.assign(f.window.visualViewport,{height:844,offsetTop:0});events.resize();
 assert.equal(properties['--loading-viewport-height'],'844px');assert.equal(properties['--loading-viewport-top'],'0px');
 Object.assign(f.window.visualViewport,{height:300,scale:2});events.resize();assert.equal(properties['--loading-viewport-height'],'844px');
 Object.assign(f.window.visualViewport,{height:750,scale:1});f.events.pageshow();assert.equal(properties['--loading-viewport-height'],'750px');
});
test('loader geometry falls back to the window height when VisualViewport is unavailable',async()=>{
 const source=await readFile('public/theme-init.js','utf8'),f=fixture(null,false),properties={};
 f.root.style.setProperty=(name,value)=>properties[name]=value;f.window.innerHeight=700;
 vm.runInNewContext(source,{document:f.document,window:f.window,localStorage:f.window.localStorage});
 assert.equal(properties['--loading-viewport-height'],'700px');
 f.window.innerHeight=820;f.events.resize();assert.equal(properties['--loading-viewport-height'],'820px');
});
