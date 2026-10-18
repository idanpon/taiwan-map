import {mergeTags} from '../public/place-tags.js';
// Import an authenticated /api/export download into an EMPTY database only.
import {categoryDefinitions,categoryId} from '../public/categories.js';
import {validStatusSymbol} from '../public/map-model.js';
import {readFileSync} from 'node:fs';import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {openDatabase,migrate} from './database.mjs';
export function importExport(db,data){
 if(!data||data.schema_version!==1||data.trip?.id!=='taiwan-2026'||data.user?.id!=='trip-shared'||!Array.isArray(data.places)||!Array.isArray(data.statuses)||!Array.isArray(data.categories))throw new Error('Unsupported export: expected shared-profile schema v1');
 for(const table of ['places','users','trips','statuses','categories','sessions'])if(db.sqlite.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())throw new Error('Target database is not empty; import aborted');
 const TRIP=data.trip.id,USER=data.user.id,now=Date.now();db.sqlite.exec('BEGIN IMMEDIATE');
 try{
  db.sqlite.prepare('INSERT INTO trips VALUES(?,?,?)').run(TRIP,data.trip.name||'Тайвань',data.trip.timezone||'Asia/Taipei');
  db.sqlite.prepare('INSERT INTO users(id,display_name,created_at) VALUES(?,?,?)').run(USER,data.user.name||'Наша поездка',now);
  db.sqlite.prepare('INSERT INTO memberships VALUES(?,?,?)').run(TRIP,USER,'owner');
  const importedCategoryIds=new Map(data.categories.map(c=>[c.id,categoryId(c.id,c.label)]));
  for(const category of categoryDefinitions){
   const imported=data.categories.find(c=>c.id===category.id)||data.categories.find(c=>importedCategoryIds.get(c.id)===category.id);
   const color=/^#[0-9a-f]{6}$/i.test(imported?.color||'')?imported.color:category.color;
   db.sqlite.prepare('INSERT INTO categories VALUES(?,?,?,?,?)').run(category.id,category.label,color,category.icon,category.sort_order);
  }
  for(const [i,s] of data.statuses.entries()){
   const symbol=s.symbol??'';if(s.dimmed!==undefined&&typeof s.dimmed!=='boolean')throw new Error('Invalid status transparency in export');if(!validStatusSymbol(symbol))throw new Error('Invalid status symbol in export');
   db.sqlite.prepare('INSERT INTO statuses(id,trip_id,label,color,sort_order,archived,created_by,symbol,version,dimmed) VALUES(?,?,?,?,?,0,?,?,?,?)').run(s.id,TRIP,s.label,s.color,s.sort_order??i,USER,symbol,Number.isSafeInteger(s.version)&&s.version>0?s.version:1,Number(s.dimmed??(s.id==='visited')));
  }
  for(const p of data.places){
   if(!p.hours||!Array.isArray(p.links)||!Number.isFinite(p.lat)||p.lat < -90||p.lat>90||!Number.isFinite(p.lon)||p.lon < -180||p.lon>180||!Number.isSafeInteger(p.version)||p.version<0)throw new Error('Invalid place in export');
   if(p.hidden!==undefined&&typeof p.hidden!=='boolean')throw new Error('Invalid place visibility in export');
   const mappedCategory=importedCategoryIds.get(p.category_id)||categoryId(p.category_id);if(!mappedCategory)throw new Error('Unknown place category in export');
   db.sqlite.prepare('INSERT INTO places(id,trip_id,name,local_name,city,category_id,lat,lon,address,summary,tip,hours_json,verified_at,updated_at,hidden,visibility_version,tags_json,tags_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(p.id,TRIP,p.name,p.local_name,p.city,mappedCategory,p.lat,p.lon,p.address,p.summary,p.tip,JSON.stringify(p.hours),p.verified_at,p.updated_at||now,Number(p.hidden??false),Number.isSafeInteger(p.visibility_version)&&p.visibility_version>0?p.visibility_version:1,JSON.stringify(mergeTags(undefined,p.tags??{})),Number.isSafeInteger(p.tags_version)&&p.tags_version>0?p.tags_version:1);
   for(const [i,l] of p.links.entries()){if(!/^https:\/\//.test(l.url))throw new Error('Non-HTTPS place link');db.sqlite.prepare('INSERT INTO place_links VALUES(?,?,?,?,?)').run(l.id||`${p.id}-${i}`,p.id,l.label,l.url,l.kind||'source')}
   if(p.version>0||p.status_id||p.note){const version=Math.max(1,p.version);db.sqlite.prepare('INSERT INTO user_place_states VALUES(?,?,?,?,?,?)').run(USER,p.id,p.status_id||null,p.note||'',version,now);db.sqlite.prepare('INSERT INTO state_events VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),USER,p.id,p.status_id||null,p.note||'',version,now)}
  }
  db.sqlite.prepare('INSERT INTO app_meta VALUES(?,?)').run('seed_v1',data.verified_at||'2026-10-18');db.sqlite.exec('COMMIT');
 }catch(e){db.sqlite.exec('ROLLBACK');throw e}
 return {places:data.places.length,statuses:data.statuses.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw new Error('Usage: DATABASE_PATH=... node server/import.mjs /private/export.json');
 const root=fileURLToPath(new URL('..',import.meta.url));const db=openDatabase(resolve(process.env.DATABASE_PATH||'data/taiwan.sqlite'));
 try{migrate(db,resolve(root,'drizzle'));console.log(JSON.stringify(importExport(db,JSON.parse(readFileSync(process.argv[2],'utf8')))))}finally{db.close()}
}
