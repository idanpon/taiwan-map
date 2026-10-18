// Private reviewed batch, using the same place row, validation and versions as the API.
import {DatabaseSync,backup} from 'node:sqlite';
import {readFileSync,existsSync,mkdirSync,chmodSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mergeTags,readTags} from '../public/place-tags.js';

export function updatePlaceTags(sqlite,manifest,{apply=false,now=Date.now()}={}){
 if(manifest?.schema_version!==1||!Array.isArray(manifest.places)||!manifest.places.length)throw new Error('Expected schema_version 1 and a non-empty places array');
 const ids=new Set();
 if(apply)sqlite.exec('BEGIN IMMEDIATE');
 try{
  const plan=manifest.places.map(item=>{
   if(typeof item.id!=='string'||ids.has(item.id)||!Number.isSafeInteger(item.version)||item.version<1)throw new Error('Invalid ID or tag version');ids.add(item.id);
   const place=sqlite.prepare('SELECT tags_json,tags_version FROM places WHERE id=? AND trip_id=?').get(item.id,'taiwan-2026');
   if(!place||place.tags_version!==item.version)throw new Error('Missing place or stale tag version: '+item.id);
   return {id:item.id,version:item.version,tags:mergeTags(readTags(place.tags_json),item.tags)};
  });
  if(apply){
   for(const item of plan){const result=sqlite.prepare('UPDATE places SET tags_json=?,tags_version=tags_version+1,updated_at=? WHERE id=? AND trip_id=? AND tags_version=?').run(JSON.stringify(item.tags),now,item.id,'taiwan-2026',item.version);if(result.changes!==1)throw new Error('Tag conflict: '+item.id)}
   if(sqlite.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Foreign key check failed');sqlite.exec('COMMIT');
  }
  return plan;
 }catch(error){if(apply)sqlite.exec('ROLLBACK');throw error}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [path,flag,backupPath]=process.argv.slice(2),apply=flag==='--apply';
 if(!path||!['--check','--apply'].includes(flag)||(apply&&!backupPath))throw new Error('Usage: DATABASE_PATH=... node server/update-place-tags.mjs manifest.json --check | --apply /private/new-backup.sqlite');
 const sqlite=new DatabaseSync(resolve(process.env.DATABASE_PATH||'data/taiwan.sqlite'),{readOnly:!apply});
 try{
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const manifest=JSON.parse(readFileSync(path,'utf8'));updatePlaceTags(sqlite,manifest);
  if(apply){
   if(existsSync(resolve(backupPath)))throw new Error('Backup already exists');
   mkdirSync(dirname(resolve(backupPath)),{recursive:true,mode:0o700});const mask=process.umask(0o077);
   try{await backup(sqlite,resolve(backupPath));chmodSync(resolve(backupPath),0o600)}finally{process.umask(mask)}
  }
  console.log(JSON.stringify({applied:apply,...(apply?{backup:resolve(backupPath)}:{}),places:updatePlaceTags(sqlite,manifest,{apply})}));
 }finally{sqlite.close()}
}
