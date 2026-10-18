import {mapConfiguration,fallbackStyle} from './map-config.js';

// One MapLibre instance. The protocol observes the actual map requests, not
// separate availability polling, and preserves HTTP cache headers and Referer.
export function createBasemapController({map,lib,theme='light',onState=()=>{},config=mapConfiguration,environment,fetcher=globalThis.fetch,clock}){
 const timers=clock||{now:()=>performance.now(),set:(fn,ms)=>setTimeout(fn,ms),clear:id=>clearTimeout(id)};
 const env=environment||{online:()=>navigator.onLine!==false,visible:()=>!document.hidden,subscribe(fn){window.addEventListener('online',fn);window.addEventListener('offline',fn);document.addEventListener('visibilitychange',fn);return()=>{window.removeEventListener('online',fn);window.removeEventListener('offline',fn);document.removeEventListener('visibilitychange',fn)}}};
 const limits=config.failure,protocol='taiwan-basemap';
 let provider='primary',generation=0,disposed=false,ready=false,hasTile=false,rootFailures=0,attempts=0,checking=false,restoring=false,decisionLatched=false;
 let failures=[],decisionTimer,rootTimer,cycleStart=0,retryAllowedAt=0,retrySequence=0,retryController,problem=null,active=env.online()&&env.visible(),pausedAt=active?null:timers.now(),pausedTotal=0;
 const running=new Set();
 const time=()=>timers.now()-pausedTotal-(pausedAt===null?0:timers.now()-pausedAt);
 const notify=(mode,extra={})=>{problem=['connection','slow','error','retry-failed'].includes(mode)?mode:null;if(!disposed)onState({mode,provider,theme,checking,canRetry:!checking&&env.online()&&env.visible()&&timers.now()>=retryAllowedAt,...extra})};
 function cancelDecision(){if(decisionTimer!==undefined)timers.clear(decisionTimer);decisionTimer=undefined}
 function cancelRoot(){if(rootTimer!==undefined)timers.clear(rootTimer);rootTimer=undefined}
 function current(epoch){return !disposed&&epoch===generation}
 function status(){notify(!active?'connection':checking?'checking':problem||(provider==='fallback'?(ready?'fallback':'loading-fallback'):(ready?'primary':'loading')))}
 function schedule(delay){
  cancelDecision();if(!disposed&&active&&!checking)decisionTimer=timers.set(()=>{decisionTimer=undefined;void evaluate()},Math.max(0,delay));
 }
 function switchStyle(style,nextProvider,{reset=true,recovery=false}={}){
  cancelDecision();cancelRoot();generation++;for(const request of running)request.abort();running.clear();
  provider=nextProvider;ready=false;hasTile=false;failures=[];decisionLatched=false;restoring=recovery;problem=null;
  if(reset){cycleStart=time();rootFailures=0;attempts=0}
  attempts++;
  // setStyle leaves the camera and DOM markers alone. Explicitly retain camera
  // state so style defaults cannot move an untouched initial view either.
  const camera={center:map.getCenter(),zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch(),padding:map.getPadding()};
  map.setStyle(style,{diff:false});map.jumpTo(camera);status();schedule(limits.initialTimeoutMs);
 }
 function primaryStyle(reset=true){switchStyle(config.styles[theme],'primary',{reset})}
 function useFallback(){switchStyle(fallbackStyle(config),'fallback')}
 async function request(url,type,{signal,timeout=limits.requestTimeoutMs,report=true,epoch=generation}={}){
  const controller=new AbortController();running.add(controller);let timedOut=false;
  const abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=timers.set(()=>{timedOut=true;controller.abort()},timeout);
  try{
   const response=await fetcher(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin'});
   if(!response.ok)throw Object.assign(new Error('Map resource HTTP '+response.status),{status:response.status,url});
   const data=type==='json'?await response.json():await response.arrayBuffer();
      return {data,cacheControl:response.headers.get('cache-control'),expires:response.headers.get('expires'),etag:response.headers.get('etag')||undefined};
  }catch(error){
   if(report&&current(epoch)&&(!controller.signal.aborted||timedOut))failure(url,type);
   throw error;
  }finally{timers.clear(timer);signal?.removeEventListener('abort',abort);running.delete(controller)}
 }
 function resource(url){
  try{const parsed=new URL(url);if(parsed.hostname===(provider==='primary'?config.primaryHost:config.fallbackHost))return parsed}catch{}
  return null;
 }
 // Only style, TileJSON and real tiles are wrapped. Sprite and glyph failures
 // cannot contribute to automatic provider failure decisions.
 function transformRequest(url,type){
  if(['Style','Source','Tile'].includes(type)&&resource(url))return {url:protocol+'://'+generation+'/'+type+'/'+encodeURIComponent(url)};
  return {url};
 }
 lib.addProtocol(protocol,async(parameters,abortController)=>{
  const match=parameters.url.match(/^taiwan-basemap:\/\/(\d+)\/(Style|Source|Tile)\/(.*)$/);
  if(!match)throw new Error('Invalid basemap request');
  const epoch=Number(match[1]),url=decodeURIComponent(match[3]);
  if(!current(epoch))throw new DOMException('Cancelled','AbortError');
  const result=await request(url,parameters.type==='json'?'json':'arrayBuffer',{signal:abortController.signal,epoch});
  if(!current(epoch)||abortController.signal.aborted)throw new DOMException('Cancelled','AbortError');
  if(match[2]==='Style'&&(result.data?.version!==8||!result.data.sources||!Array.isArray(result.data.layers))){failure(url,'json');throw new Error('Invalid basemap style')}
  if(match[2]==='Tile'&&current(epoch)){
   hasTile=true;if(active){ready=true;failures=[];rootFailures=0;cancelDecision();restoring=false;problem=null;status()}
  }
  return result;
 });
 function failure(url,type){
  if(!active||checking||decisionLatched)return;
  const t=time();failures=failures.filter(x=>t-x.at<=limits.errorWindowMs);failures.push({url,at:t});
  if(provider==='primary'&&type==='json'&&!ready){
   rootFailures++;
   if(!restoring&&attempts<limits.styleAttempts&&!rootTimer)rootTimer=timers.set(()=>{rootTimer=undefined;if(active&&!disposed)primaryStyle(false)},limits.styleRetryMs);
  }
  schedule(Math.min(Math.max(0,cycleStart+limits.initialTimeoutMs-t),limits.errorGraceMs));void evaluate();
 }
 async function connectivity(){
  const controller=new AbortController(),timer=timers.set(()=>controller.abort(),limits.connectivityTimeoutMs);
  try{return (await fetcher(new URL('./map-config.js',import.meta.url).href,{signal:controller.signal,cache:'no-store',credentials:'omit'})).ok}catch{return false}finally{timers.clear(timer)}
 }
 async function evaluate(){
  if(disposed||!active||checking||decisionLatched)return;
  const t=time();failures=failures.filter(x=>t-x.at<=limits.errorWindowMs);
  const distinct=new Set(failures.map(x=>x.url)).size,first=failures[0]?.at??t;
  const sustained=distinct>=limits.errorCount&&t-first>=limits.errorGraceMs;
  const initial=!ready&&t-cycleStart>=limits.initialTimeoutMs&&(rootFailures>=2||failures.length>=2);
  if(!sustained&&!initial){
   if(distinct>=limits.errorCount)schedule(limits.errorGraceMs-(t-first));
   else if(!ready&&t-cycleStart<limits.initialTimeoutMs)schedule(cycleStart+limits.initialTimeoutMs-t);
   else if(!ready){decisionLatched=true;notify('slow')}
   return;
  }
  decisionLatched=true;const epoch=generation;
  // navigator.onLine is only a hint. A single same-origin network check on a
  // failure decision avoids declaring a provider down when all access is lost.
  const connected=await connectivity();
  if(!current(epoch)||!active)return;
  if(!connected||!env.online()){notify('connection');return}
  if(provider==='primary')useFallback();else notify('error');
 }
 async function retry(){
  if(disposed||checking||!active||timers.now()<retryAllowedAt)return false;
  checking=true;retryAllowedAt=timers.now()+limits.retryCooldownMs;cancelDecision();cancelRoot();notify('checking');
  const epoch=generation,sequence=++retrySequence;retryController=new AbortController();
  try{
   // Preflight the selected primary style and one visible vector tile while the
   // existing reserve stays rendered. No reserve is loaded during normal use.
   const {data:style}=await request(config.styles[theme],'json',{report:false,signal:retryController.signal});
   if(style?.version!==8||!style.sources||!Array.isArray(style.layers))throw new Error('Invalid primary style');
   const vector=Object.values(style.sources).find(source=>source.type==='vector');
   if(!vector)throw new Error('Primary vector source missing');
   const metadata=vector.url?(await request(vector.url,'json',{report:false,signal:retryController.signal})).data:vector;
   const template=metadata.tiles?.[0];if(!template)throw new Error('Primary tiles missing');
   const center=map.getCenter(),z=Math.min(metadata.maxzoom??14,Math.max(metadata.minzoom??0,Math.floor(map.getZoom()))),n=2**z;
   const x=Math.floor(((center.lng+180)%360+360)%360/360*n),lat=Math.max(-85.0511,Math.min(85.0511,center.lat))*Math.PI/180,y=Math.max(0,Math.min(n-1,Math.floor((1-Math.asinh(Math.tan(lat))/Math.PI)/2*n)));
   await request(template.replace('{z}',z).replace('{x}',x).replace('{y}',y),'arrayBuffer',{report:false,signal:retryController.signal});
   if(!current(epoch)||sequence!==retrySequence||!active)return false;
   checking=false;switchStyle(style,'primary',{recovery:true});return true;
  }catch{
   if(current(epoch)&&sequence===retrySequence){checking=false;notify(active?(provider==='fallback'?'retry-failed':'error'):'connection')}
   return false;
  }finally{
   if(current(epoch)&&sequence===retrySequence&&checking)checking=false;
   // Cooldown only changes the button; it performs no availability request.
   if(!disposed&&timers.now()<retryAllowedAt)timers.set(()=>{if(!disposed&&!checking)status()},retryAllowedAt-timers.now());
  }
 }
 function environmentChanged(){
  const next=env.online()&&env.visible();if(next===active){status();return}
  active=next;
  if(!active){pausedAt=timers.now();cancelDecision();cancelRoot();notify('connection');return}
  pausedTotal+=timers.now()-pausedAt;pausedAt=null;decisionLatched=false;problem=null;
  if(hasTile){ready=true;failures=[];status()}
  else if(provider==='primary')primaryStyle();else useFallback();
 }
 const unsubscribe=env.subscribe(environmentChanged);
 return {
  transformRequest,start(){primaryStyle()},retry,
  setTheme(value){if(theme===value)return;theme=value;if(checking){retrySequence++;retryController?.abort();checking=false}if(provider==='primary'){if(active)primaryStyle();else status()}else status()},
  get provider(){return provider},
  dispose(){disposed=true;generation++;cancelDecision();cancelRoot();unsubscribe();for(const controller of running)controller.abort();running.clear();lib.removeProtocol(protocol)}
 };
}
