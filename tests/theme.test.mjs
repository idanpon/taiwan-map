import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
import {createThemeUI} from '../public/theme.js';
import {statusAppearance} from '../public/map-model.js';
function fixture(saved,system=false,storageFails=false){
 const events={},media={matches:system,addEventListener(type,fn){this.change=fn}},controls=[0,1].map(()=>({value:'',addEventListener(type,fn){this.change=fn}}));
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
  f.media.change({matches:true});assert.equal(ui.value,'dark');assert.ok(f.controls.every(x=>x.value==='dark'));
  f.controls[1].value='light';f.controls[1].change();assert.equal(ui.value,'light');f.media.change({matches:true});assert.equal(ui.value,'light');assert.equal(f.controls[0].value,'light');
  if(!blocked)assert.equal(f.saved,'light');assert.equal(changes.at(-1),'light');
  f.events.storage({key:'taiwan-map-theme',newValue:'dark'});assert.equal(ui.value,'dark');
 }
});
test('themes preserve status color, symbol and opacity while keeping labels legible',()=>{
 for(const color of ['#facc15','#1456e0','#dc2626','#6b7280'])for(const theme of ['light','dark']){
  const value=statusAppearance({color,symbol:'✓',dimmed:true},theme);assert.equal(value.color,color);assert.equal(value.symbol,'✓');assert.equal(value.opacity,0.7);assert.match(value.textColor,/^#[0-9a-f]{6}$/i);
 }
});
