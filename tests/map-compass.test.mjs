import test from 'node:test';import assert from 'node:assert/strict';
import {createCompassControl} from '../public/map-compass.js';
function fixture(bearing=0){
 const camera={bearing,center:[121.54,25.04],zoom:14,pitch:20},events=new Map(),clicks=new Map(),properties={},document={activeElement:null},resets=[];
 const canvas={focus(options){document.activeElement=canvas;this.focusOptions=options}};
 const button={hidden:true,disabled:true,ownerDocument:document,style:{setProperty:(name,value)=>properties[name]=value},addEventListener:(name,handler)=>clicks.set(name,handler),removeEventListener:name=>clicks.delete(name)};
 const map={getBearing:()=>camera.bearing,getCanvas:()=>canvas,on:(name,handler)=>events.set(name,handler),off:name=>events.delete(name),resetNorth(options){resets.push(options);camera.bearing=0;events.get('rotate')?.()}};
 const control=createCompassControl({map,button});
 return {camera,button,canvas,document,properties,resets,events,control,click:()=>clicks.get('click')?.(),rotate(value){camera.bearing=value;events.get('rotate')?.()}};
}
test('compass appears only away from north and normalizes complete turns',()=>{
 const f=fixture();assert.equal(f.button.hidden,true);
 for(const value of [0,360,-360,720,359.95,-.05,NaN]){f.rotate(value);assert.equal(f.button.hidden,true,String(value))}
 for(const value of [15,-15,180,-180,450,.2]){f.rotate(value);assert.equal(f.button.hidden,false,String(value))}
});
test('compass needle points north as the map rotates in either direction',()=>{
 const f=fixture(90);assert.equal(f.properties['--north-bearing'],'-90deg');
 f.rotate(-45);assert.equal(f.properties['--north-bearing'],'45deg');
});
test('reset preserves camera position, zoom and pitch, hides the compass and restores keyboard focus',()=>{
 const f=fixture(45),before={...f.camera};f.document.activeElement=f.button;f.click();
 assert.deepEqual(f.resets,[{duration:300}]);assert.deepEqual(f.camera,{...before,bearing:0});assert.equal(f.button.hidden,true);assert.equal(f.document.activeElement,f.canvas);assert.deepEqual(f.canvas.focusOptions,{preventScroll:true});
 f.click();assert.equal(f.resets.length,1);
});
test('disposal hides and disables the compass and releases listeners',()=>{
 const f=fixture(30);assert.equal(f.button.hidden,false);f.control.dispose();f.control.dispose();
 assert.equal(f.button.hidden,true);assert.equal(f.button.disabled,true);assert.equal(f.events.size,0);
 f.rotate(90);f.click();assert.equal(f.button.hidden,true);assert.equal(f.resets.length,0);
});
