import test from 'node:test';
import assert from 'node:assert/strict';
import {createBasemapController} from '../public/basemap.js';
import {mapConfiguration,fallbackStyle} from '../public/map-config.js';
import {accuracyPolygon} from '../public/map-view.js';

const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
function fakeClock(){
 let now=0,id=0;const tasks=new Map();
 return {now:()=>now,set(fn,ms){const n=++id;tasks.set(n,{at:now+ms,fn});return n},clear:n=>tasks.delete(n),async advance(ms){
  const target=now+ms;await flush();let guard=0;
  while(true){const next=[...tasks].filter(([,x])=>x.at<=target).sort(([,a],[,b])=>a.at-b.at)[0];if(!next)break;
   assert.ok(++guard<200,'timer loop');now=next[1].at;tasks.delete(next[0]);next[1].fn();await flush();
  }now=target;await flush();
 }};
}
function fixture(){
 const clock=fakeClock(),protocols=new Map(),requests=[],states=[],styles=[];
 const env={connected:true,shown:true,online(){return this.connected},visible(){return this.shown},subscribe(fn){this.change=fn;return()=>{}}};
 const camera={center:{lng:121.54,lat:25.04},zoom:13,bearing:12,pitch:15,padding:{top:1,bottom:2,left:3,right:4}};
 const flags={root:false,metadata:false,hang:false,tiles:false,reserve:false,origin:false};
 const style={version:8,sources:{vector:{type:'vector',url:'https://tiles.openfreemap.org/planet'}},layers:[]};
 const lib={addProtocol:(id,fn)=>protocols.set(id,fn),removeProtocol:id=>protocols.delete(id)};
 let controller;
 const map={getCenter:()=>camera.center,getZoom:()=>camera.zoom,getBearing:()=>camera.bearing,getPitch:()=>camera.pitch,getPadding:()=>camera.padding,jumpTo:value=>assert.deepEqual(value,camera),setStyle(value){
  styles.push(value);if(typeof value==='string')void load(value,'Style','json').catch(()=>{});
 }};
 const fetcher=async(url,options)=>{
  requests.push({url,options});const u=new URL(url);
  if(flags.hang)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  if((u.pathname.includes('/styles/')&&flags.root)||(u.pathname==='/planet'&&flags.metadata)||(u.pathname.endsWith('.pbf')&&flags.tiles)||(u.hostname==='tile.openstreetmap.org'&&flags.reserve)||(u.hostname!=='tiles.openfreemap.org'&&u.hostname!=='tile.openstreetmap.org'&&flags.origin))throw new TypeError('Network unavailable');
  const data=u.pathname.includes('/styles/')?style:u.pathname==='/planet'?{tiles:['https://tiles.openfreemap.org/tiles/{z}/{x}/{y}.pbf'],maxzoom:14}:new Uint8Array([1,2,3]);
  return new Response(data instanceof Uint8Array?data:JSON.stringify(data),{headers:{'cache-control':'public, max-age=604800','expires':'Wed, 21 Oct 2026 07:28:00 GMT','etag':'test-tile'}});
 };
 async function load(url,type='Tile',dataType='arrayBuffer'){
  const transformed=controller.transformRequest(url,type);
  if(transformed.url===url)return fetcher(url,{});
  return protocols.get('taiwan-basemap')({url:transformed.url,type:dataType},new AbortController());
 }
 controller=createBasemapController({map,lib,theme:'light',onState:s=>states.push(s),environment:env,clock,fetcher});
 return {controller,clock,env,flags,states,styles,requests,load,async start(){controller.start();await flush()},async healthy(){await this.start();await load('https://tiles.openfreemap.org/tiles/13/6860/3500.pbf')},async failTiles(){flags.tiles=true;for(let i=0;i<4;i++)await load('https://tiles.openfreemap.org/tiles/13/6860/'+(3501+i)+'.pbf').catch(()=>{});await clock.advance(4100)}};
}
test('normal map requests do not load or probe the reserve and retain cache headers and web Referer policy',async()=>{
 const f=fixture();await f.healthy();await f.clock.advance(120000);
 assert.equal(f.controller.provider,'primary');assert.equal(f.requests.length,2);assert.equal(f.states.at(-1).mode,'primary');
 const tile=await f.load('https://tiles.openfreemap.org/tiles/13/6860/3501.pbf');assert.equal(tile.cacheControl,'public, max-age=604800');assert.equal(tile.etag,'test-tile');
 for(const r of f.requests){assert.equal(r.options.cache,undefined);assert.equal(r.options.referrerPolicy,'strict-origin-when-cross-origin');assert.equal(r.options.headers,undefined)}
 f.controller.dispose();
});
test('a single tile error, repeated failure of that one tile, and sprite/glyph errors never trip provider fallback',async()=>{
 const f=fixture();await f.healthy();f.flags.tiles=true;
 for(let i=0;i<5;i++)await f.load('https://tiles.openfreemap.org/tiles/13/1/1.pbf').catch(()=>{});
 assert.equal(f.controller.transformRequest('https://tiles.openfreemap.org/sprites/ofm.png','SpriteImage').url,'https://tiles.openfreemap.org/sprites/ofm.png');
 assert.equal(f.controller.transformRequest('https://tiles.openfreemap.org/fonts/font/0-255.pbf','Glyphs').url,'https://tiles.openfreemap.org/fonts/font/0-255.pbf');
 await f.clock.advance(120000);assert.equal(f.controller.provider,'primary');assert.equal(f.styles.length,1);assert.ok(!f.requests.some(r=>r.url.includes('map-config.js')));f.controller.dispose();
});
test('sustained runtime failure latches the reserve once; theme changes and failed manual recovery retain its camera and working style',async()=>{
 const f=fixture();await f.healthy();await f.failTiles();assert.equal(f.controller.provider,'fallback');assert.equal(f.styles.length,2);
 await f.load('https://tile.openstreetmap.org/13/6860/3500.png');assert.equal(f.states.at(-1).mode,'fallback');
 f.controller.setTheme('dark');assert.equal(f.styles.length,2);assert.equal(f.states.at(-1).theme,'dark');
 f.flags.root=true;const before=f.styles.length;assert.equal(await f.controller.retry(),false);assert.equal(f.styles.length,before);assert.equal(f.controller.provider,'fallback');assert.equal(f.states.at(-1).mode,'retry-failed');
 await f.clock.advance(120000);assert.equal(f.styles.length,before);assert.equal(f.states.at(-1).canRetry,true);f.controller.dispose();
});
test('cold style failures use bounded retries plus timeout, then a single local reserve style with no OpenFreeMap dependency',async()=>{
 const f=fixture();f.flags.root=true;await f.start();await f.clock.advance(19000);
 assert.equal(f.controller.provider,'fallback');assert.equal(f.styles.filter(s=>typeof s==='string').length,3);assert.deepEqual(f.styles.at(-1),fallbackStyle());
 assert.ok(!JSON.stringify(f.styles.at(-1)).includes('openfreemap'));await f.clock.advance(120000);assert.equal(f.styles.length,4);f.controller.dispose();
});
test('offline and background time cannot prove a provider outage, including initial style failure',async()=>{
 for(const kind of ['connected','shown']){
  const f=fixture();await f.healthy();f.env[kind]=false;f.env.change();await f.failTiles();await f.clock.advance(120000);
  assert.equal(f.controller.provider,'primary');assert.ok(!f.requests.some(r=>r.url.includes('map-config.js')));
  f.env[kind]=true;f.env.change();await f.clock.advance(120000);assert.equal(f.controller.provider,'primary');f.controller.dispose();
 }
 const f=fixture();f.flags.root=true;f.env.connected=false;f.env.change();await f.start();await f.clock.advance(120000);assert.equal(f.controller.provider,'primary');f.controller.dispose();
});
test('failure of the same-origin connectivity check reports connection loss without probing or loading OSM',async()=>{
 const f=fixture();await f.healthy();f.flags.origin=true;await f.failTiles();assert.equal(f.controller.provider,'primary');assert.equal(f.states.at(-1).mode,'connection');
 const count=f.requests.length;await f.clock.advance(120000);assert.equal(f.requests.length,count);f.controller.dispose();
});
test('if the reserve fails as well, show an error and never switch back or loop',async()=>{
 const f=fixture();await f.healthy();await f.failTiles();f.flags.reserve=true;
 for(let i=0;i<4;i++)await f.load('https://tile.openstreetmap.org/13/6860/'+(3500+i)+'.png').catch(()=>{});
 await f.clock.advance(4100);assert.equal(f.states.at(-1).mode,'error');assert.equal(f.controller.provider,'fallback');
 f.controller.setTheme('dark');assert.equal(f.states.at(-1).mode,'error');const count=f.requests.length;await f.clock.advance(120000);assert.equal(f.requests.length,count);assert.equal(f.styles.length,2);f.controller.dispose();
});
test('explicit recovery restores the selected official style; another subsequent outage returns to reserve without automatic primary retries',async()=>{
 const f=fixture();await f.healthy();await f.failTiles();await f.load('https://tile.openstreetmap.org/13/6860/3500.png');
 f.controller.setTheme('dark');f.flags.tiles=false;assert.equal(await f.controller.retry(),true);assert.equal(f.controller.provider,'primary');assert.equal(typeof f.styles.at(-1),'object');
 assert.ok(f.requests.some(r=>r.url===mapConfiguration.styles.dark));await f.load('https://tiles.openfreemap.org/tiles/13/6860/3500.pbf');
 await f.failTiles();assert.equal(f.controller.provider,'fallback');const count=f.styles.length;await f.clock.advance(120000);assert.equal(f.styles.length,count);f.controller.dispose();
});
test('geolocation accuracy geometry is independent of styles and closes its ring near Taipei and Tainan',()=>{
 for(const [lng,lat] of [[121.54,25.04],[120.2,22.99]]){
  const ring=accuracyPolygon(lng,lat,50).geometry.coordinates[0];assert.equal(ring.length,65);assert.ok(Math.abs(ring[0][0]-ring.at(-1)[0])<1e-8);assert.ok(Math.abs(ring[0][1]-ring.at(-1)[1])<1e-8);
  for(const [x,y] of ring){assert.ok(Number.isFinite(x)&&Number.isFinite(y));assert.ok(Math.abs(x-lng)<0.001&&Math.abs(y-lat)<0.001)}
 }
});

test('initial TileJSON failure receives bounded style retries before reserve, even when style documents load',async()=>{
 const f=fixture();f.flags.metadata=true;await f.start();
 for(let i=0;i<3;i++){await f.load('https://tiles.openfreemap.org/planet','Source','json').catch(()=>{});await f.clock.advance(1600)}
 await f.clock.advance(14000);assert.equal(f.controller.provider,'fallback');assert.equal(f.styles.filter(s=>typeof s==='string').length,3);f.controller.dispose();
});
test('requests that never respond time out, sample the provider again and reach a bounded loading decision',async()=>{
 const f=fixture();f.flags.hang=true;await f.start();await f.clock.advance(17500);f.flags.hang=false;await f.clock.advance(1000);
 assert.equal(f.controller.provider,'fallback');assert.equal(f.styles.filter(s=>typeof s==='string').length,2);f.controller.dispose();
});
