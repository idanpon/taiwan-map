import {createInitialMapFraming} from './map-framing.js';
import {mapConfiguration} from './map-config.js';
import {createBasemapController} from './basemap.js';
import {categoryIcon} from './categories.js';
import {createCompassControl} from './map-compass.js';

export function accuracyPolygon(lng,lat,meters){
 const radius=Math.max(0,meters)/6371008.8,phi=lat*Math.PI/180,lambda=lng*Math.PI/180,ring=[];
 for(let i=0;i<=64;i++){
  const angle=i/64*Math.PI*2,p=Math.asin(Math.sin(phi)*Math.cos(radius)+Math.cos(phi)*Math.sin(radius)*Math.cos(angle));
  const l=lambda+Math.atan2(Math.sin(angle)*Math.sin(radius)*Math.cos(phi),Math.cos(radius)-Math.sin(phi)*Math.sin(p));
  ring.push([l*180/Math.PI,p*180/Math.PI]);
 }
 return {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ring]}};
}

export function createMapView({container,statusElement,retryButton,statusText,listButton,zoomIn,zoomOut,northButton,onSelect,onZoomGroupChange,onUnavailable,theme='light',config=mapConfiguration}){
 let map,lib,basemap,compass,attribution,disposed=false,usable=false,places=[],selected=null,markers=[],lastGrouped=false,position,positionMarker,focusRequest,fitRequested=false;
 const initialFraming=createInitialMapFraming({fit:fitPlaces});
 const controls=[zoomIn,zoomOut,northButton];
 const messages={
  loading:'Загрузка основной карты…',
  'loading-fallback':'Включается резервная карта…',
  fallback:'Включена резервная карта',
  checking:'Проверяем основную карту. Резервная остаётся доступной.',
  'retry-failed':'Основная карта пока недоступна. Включена резервная карта.',
  connection:'Проверьте подключение к интернету. Места и ссылки доступны в списке.',
  slow:'Карта загружается дольше обычного. Места и ссылки доступны в списке.',
  error:'Подложки карты недоступны. Места и ссылки доступны в списке.',
  unsupported:'Не удалось запустить MapLibre/WebGL. Места и ссылки доступны в списке.'
 };
 function state(value){
  if(disposed)return;
  container.dataset.provider=value.provider;container.dataset.mapState=value.mode;
  statusElement.hidden=value.mode==='primary';statusText.textContent=messages[value.mode]||'';
  retryButton.hidden=['loading','loading-fallback','unsupported'].includes(value.mode);retryButton.disabled=!value.canRetry;
  listButton.hidden=!['connection','slow','error','unsupported'].includes(value.mode);
  if(map&&lib&&attribution?.provider!==value.provider){
   if(attribution)map.removeControl(attribution.control);
   const control=new lib.AttributionControl({compact:false});
   map.addControl(control,'bottom-left');attribution={provider:value.provider,control};
  }
 }
 function unsupported(){
  usable=false;compass?.dispose();northButton.hidden=true;
  state({mode:'unsupported',provider:'none',canRetry:false});for(const control of controls)control.disabled=true;
  onUnavailable?.();
 }
 function clearMarkers(){for(const marker of markers)marker.remove();markers=[]}
 function markerButton(label,className){
  const element=document.createElement('button');element.type='button';element.className=className;
  element.setAttribute('aria-label',label);element.dataset.label=label;return element;
 }
 function render(){
  if(!map||!lib||disposed)return;clearMarkers();lastGrouped=map.getZoom()<10;
  if(lastGrouped){
   for(const name of [...new Set(places.map(p=>p.city))]){
    const group=places.filter(p=>p.city===name),lat=group.reduce((s,p)=>s+p.lat,0)/group.length,lon=group.reduce((s,p)=>s+p.lon,0)/group.length;
    const element=markerButton(name+' · '+group.length+' мест','map-pin-button city-cluster');element.textContent=group.length;
    element.addEventListener('click',event=>{event.stopPropagation();fitPlaces(group)});
    markers.push(new lib.Marker({element,anchor:'center'}).setLngLat([lon,lat]).addTo(map));
   }return;
  }
  for(const p of places){
   const c=p.category,s=p.status,label=p.name+(s?' · '+s.label:'');
   const element=markerButton(label,'map-pin-button');element.style.zIndex=p.id===selected?'500':'0';
   const pin=document.createElement('span');pin.className='pin';pin.style.setProperty('--category',c.color);pin.style.setProperty('--status',s?.color||c.color);pin.style.setProperty('--status-opacity',s?.opacity??1);pin.style.setProperty('--status-symbol',s?.symbolColor||'#fff');pin.setAttribute('aria-hidden','true');pin.innerHTML=categoryIcon(c.icon);
   if(s){const badge=document.createElement('i');badge.className='pin-state';badge.textContent=s.symbol;pin.append(badge)}
   element.append(pin);element.addEventListener('click',event=>{event.stopPropagation();onSelect(p.id)});
   markers.push(new lib.Marker({element,anchor:'center'}).setLngLat([p.lon,p.lat]).addTo(map));
  }
 }
 function fitPlaces(values=places){
  initialFraming.cancel();
  if(!map){fitRequested=true;return}if(!values.length)return;
  const bounds=new lib.LngLatBounds();for(const p of values)bounds.extend([p.lon,p.lat]);
  map.fitBounds(bounds,{padding:{top:70,bottom:70,left:60,right:60},maxZoom:14,duration:0});
 }
 function focusPlace(p,offset=[0,0],zoomToPlace=true){
  initialFraming.cancel();
  if(!map){focusRequest={p,offset,zoomToPlace};return}
  focusRequest=null;
  // One absolute camera target avoids accumulating panel offsets across clicks.
  // MapLibre also honours the system reduced-motion preference for this ease.
  map.easeTo({center:[p.lon,p.lat],offset,duration:300,...(zoomToPlace?{zoom:Math.max(14,map.getZoom())}:{})});
 }
 function restorePosition(){
  if(!map||!position||!map.isStyleLoaded())return;
  const feature=accuracyPolygon(position.lng,position.lat,position.accuracy);
  const source=map.getSource('taiwan-user-accuracy');
  if(source)source.setData(feature);
  else{
   map.addSource('taiwan-user-accuracy',{type:'geojson',data:feature});
   map.addLayer({id:'taiwan-user-accuracy-fill',type:'fill',source:'taiwan-user-accuracy',paint:{'fill-color':'#3885cf','fill-opacity':0.12}});
   map.addLayer({id:'taiwan-user-accuracy-line',type:'line',source:'taiwan-user-accuracy',paint:{'line-color':'#3885cf','line-width':1.5}});
  }
 }
 retryButton.addEventListener('click',()=>{void basemap?.retry()});
 zoomIn.addEventListener('click',()=>map?.zoomIn({duration:0}));zoomOut.addEventListener('click',()=>map?.zoomOut({duration:0}));
 const initialized=(async()=>{
  try{
   lib=await import('./vendor/maplibre-6.15.0/maplibre-gl.js');if(disposed)return;
   lib.setWorkerUrl(new URL(config.worker,import.meta.url).href);
   map=new lib.Map({container,style:{version:8,sources:{},layers:[]},center:[120.9,23.7],zoom:6.5,attributionControl:false,renderWorldCopies:false,refreshExpiredTiles:true,cancelPendingTileRequestsWhileZooming:true});usable=true;
   compass=createCompassControl({map,button:northButton});
   basemap=createBasemapController({map,lib,theme,onState:state,config});map.setTransformRequest(basemap.transformRequest);
   map.on('style.load',restorePosition);
   map.on('error',event=>{if(/WebGL|GPU context|worker.*(?:failed|error|load)/i.test(event.error?.message||'')){basemap?.dispose();unsupported()}});
   map.on('zoomend',()=>{const grouped=map.getZoom()<10;if(grouped!==lastGrouped){render();onZoomGroupChange?.()}});
   map.getCanvas().addEventListener('webglcontextlost',()=>{basemap?.dispose();unsupported()});
   map.getCanvas().addEventListener('webglcontextrestored',()=>{if(!disposed)unsupported()});
   if(focusRequest)focusPlace(focusRequest.p,focusRequest.offset,focusRequest.zoomToPlace);else if(fitRequested)fitPlaces();else initialFraming.update(Boolean(map),places);
   basemap.start();render();
  }catch{map?.remove();map=null;unsupported()}
 })();
 return {
  initialized,
  setPlaces(values,id){places=values;selected=id;initialFraming.update(Boolean(map),places);render()},
  setTheme(value){theme=value;basemap?.setTheme(value)},
  fit:fitPlaces,focusPlace,centerPlace:p=>focusPlace(p,[0,0],false),
  resize(){map?.resize()},
  get available(){return usable},
  showPosition(coords){
   initialFraming.cancel();
   position={lng:coords.longitude,lat:coords.latitude,accuracy:coords.accuracy};
   if(!map)return;
   positionMarker?.remove();const element=document.createElement('span');element.className='user-position';element.setAttribute('aria-label','Моё местоположение');
   positionMarker=new lib.Marker({element}).setLngLat([position.lng,position.lat]).addTo(map);restorePosition();
   map.jumpTo({center:[position.lng,position.lat],zoom:15});
  },
  dispose(){disposed=true;basemap?.dispose();compass?.dispose();clearMarkers();positionMarker?.remove();map?.remove();map=null}
 };
}
