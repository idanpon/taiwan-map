// Add reviewed CSV records to an existing map. Never writes visit states.
import {createHash} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {readFileSync,mkdirSync,chmodSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const TRIP='taiwan-2026';
const fingerprint=row=>createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))))).digest('hex');
export function importPlaces(sqlite,manifest,{apply=false,now=Date.now()}={}){
 if(manifest?.schema_version!==1||manifest.source!=='taiwan-trip-csv'||!Array.isArray(manifest.records))throw new Error('Unsupported import manifest');
 const seen=new Set(),plans=[];
 const categories=new Map(sqlite.prepare('SELECT label,id FROM categories').all().map(c=>[c.label,c.id]));
 for(const item of manifest.records){
  const row=item.row;
  if(!row||!/^TW\d{3}$/.test(row.id)||seen.has(row.id))throw new Error('Invalid or duplicate source ID');
  seen.add(row.id);
  if(!['import','review','separate'].includes(row.import_action))throw new Error('Unknown import action: '+row.id);
  if(row.import_action!=='import'){plans.push({id:row.id,result:row.import_action});continue}
  const category=categories.get(row.category);if(!category)throw new Error('Unknown category: '+row.id);
  const key='import:taiwan-trip-csv:'+row.id,hash=fingerprint(row);
  const previous=sqlite.prepare('SELECT value FROM app_meta WHERE key=?').get(key);
  if(previous){
   const saved=JSON.parse(previous.value);
   if(saved.hash!==hash)throw new Error('Source record changed; manual reconciliation required: '+row.id);
   if(!sqlite.prepare('SELECT 1 FROM places WHERE id=? AND trip_id=?').get(saved.place_id,TRIP))throw new Error('Import mapping target missing: '+row.id);
   plans.push({id:row.id,place_id:saved.place_id,result:'unchanged'});continue;
  }
  const placeId=item.existing_id||row.id;
  const existing=sqlite.prepare('SELECT * FROM places WHERE id=?').get(placeId);
  if(item.existing_id){
   if(!existing||existing.trip_id!==TRIP)throw new Error('Existing match missing: '+row.id);
   if(existing.category_id!==category&&!(item.category_change?.from===existing.category_id&&item.category_change?.to===category))throw new Error('Category conflict: '+row.id);
   plans.push({id:row.id,place_id:placeId,result:'matched',category,change_category:existing.category_id!==category,key,hash,item});continue;
  }
  if(existing)throw new Error('ID already exists without an explicit match: '+row.id);
  if(!item.geocoding){plans.push({id:row.id,result:'pending',reason:item.pending_reason||'Coordinates need review'});continue}
  const g=item.geocoding;
  if(g.reviewed!==true||!Number.isFinite(g.lat)||!Number.isFinite(g.lon)||g.lat<21.8||g.lat>25.7||g.lon<119.2||g.lon>122.1||!g.precision||!/^https:\/\//.test(g.source_url||''))throw new Error('Unreviewed or invalid Taiwan coordinates: '+row.id);
  if(!row.name?.trim()||!row.city?.trim())throw new Error('Missing place name or city: '+row.id);
  plans.push({id:row.id,place_id:placeId,result:'added',category,key,hash,item});
 }
 const report=()=>plans.map(({id,place_id,result,reason,change_category})=>({id,...(place_id?{place_id}:{}),result,...(reason?{reason}:{}),...(change_category?{category_changed:true}:{})}));
 if(!apply)return report();
 sqlite.exec('BEGIN IMMEDIATE');
 try{
  for(const p of plans){
   if(!['added','matched'].includes(p.result))continue;
   const {row,geocoding:g}=p.item;
   if(p.result==='added'){
    const tip=[row.route_role&&'Маршрут: '+row.route_role,row.day_hint&&'Этап: '+row.day_hint,row.transport&&'Как добраться: '+row.transport,'Геометка: '+g.precision,g.note].filter(Boolean).join('\n');
    const hours={weekly:[],exceptions:[],label:'Не проверены',note:'Расписание не проверялось при импорте.',timezone:'Asia/Taipei'};
    sqlite.prepare('INSERT INTO places(id,trip_id,name,local_name,city,category_id,lat,lon,address,summary,tip,hours_json,verified_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(p.place_id,TRIP,row.name,row.local_name||'',row.city,p.category,g.lat,g.lon,g.address||row.location_hint||'',row.note||'',tip,JSON.stringify(hours),'',now);
    sqlite.prepare('INSERT INTO place_links(id,place_id,label,url,kind) VALUES(?,?,?,?,?)').run(p.place_id+'-geocoding',p.place_id,g.source_label||'Источник координат',g.source_url,'source');
    for(const [i,link] of (g.links||[]).entries()){
     if(!/^https:\/\//.test(link.url))throw new Error('Invalid source link');
     sqlite.prepare('INSERT INTO place_links VALUES(?,?,?,?,?)').run(p.place_id+'-source-'+i,p.place_id,link.label,link.url,'source');
    }
   }else if(p.change_category)sqlite.prepare('UPDATE places SET category_id=?,updated_at=? WHERE id=?').run(p.category,now,p.place_id);
   sqlite.prepare('INSERT INTO app_meta(key,value) VALUES(?,?)').run(p.key,JSON.stringify({place_id:p.place_id,hash:p.hash,row,geocoding:g||null,imported_at:now}));
  }
  if(sqlite.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Foreign key check failed');
  sqlite.exec('COMMIT');return report();
 }catch(error){sqlite.exec('ROLLBACK');throw error}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [manifestPath,flag,backupPath]=process.argv.slice(2),apply=flag==='--apply';
 if(!manifestPath||!['--check','--apply'].includes(flag)||(apply&&!backupPath))throw new Error('Usage: DATABASE_PATH=... node server/import-places.mjs manifest.json --check | --apply /private/backup.sqlite');
 const sqlite=new DatabaseSync(resolve(process.env.DATABASE_PATH||'data/taiwan.sqlite'),{readOnly:!apply});
 try{
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  importPlaces(sqlite,manifest); // Validate the whole batch before backup or writes.
  if(apply){
   if(existsSync(resolve(backupPath)))throw new Error('Backup already exists; use a new path');
   mkdirSync(dirname(resolve(backupPath)),{recursive:true,mode:0o700});
   const previousMask=process.umask(0o077);
   try{await backup(sqlite,resolve(backupPath));chmodSync(resolve(backupPath),0o600)}finally{process.umask(previousMask)}
  }
  console.log(JSON.stringify({applied:apply,...(apply?{backup:resolve(backupPath)}:{}),records:importPlaces(sqlite,manifest,{apply})}));
 }finally{sqlite.close()}
}
