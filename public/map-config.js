// Provider URLs and failure thresholds are centralized here; no API keys.
export const mapConfiguration=Object.freeze({
 engineVersion:'6.15.0',
 worker:'./vendor/maplibre-6.15.0/maplibre-gl-worker.js',
 styles:Object.freeze({light:'https://tiles.openfreemap.org/styles/bright',dark:'https://tiles.openfreemap.org/styles/fiord'}),
 primaryHost:'tiles.openfreemap.org',
 fallbackTiles:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
 fallbackHost:'tile.openstreetmap.org',
 failure:Object.freeze({requestTimeoutMs:8000,initialTimeoutMs:18000,errorWindowMs:20000,errorCount:4,errorGraceMs:4000,styleAttempts:3,styleRetryMs:1500,connectivityTimeoutMs:3500,retryCooldownMs:5000})
});
export function fallbackStyle(config=mapConfiguration){
 return {version:8,sources:{'osm-reserve':{type:'raster',tiles:[config.fallbackTiles],tileSize:256,minzoom:0,maxzoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'}},layers:[{id:'reserve-background',type:'background',paint:{'background-color':'#f2efe9'}},{id:'osm-reserve',type:'raster',source:'osm-reserve'}]};
}
