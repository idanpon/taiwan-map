import {readFileSync,existsSync,mkdirSync,chmodSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {openDatabase} from './database.mjs';
import {handlePlanning} from '../src/planning.mjs';
import {TRIP} from '../src/auth.mjs';
export async function importPlanning(db,manifest,actorId){
 if(!manifest||!/^[-a-z0-9]{1,100}$/.test(manifest.namespace)||!Array.isArray(manifest.items)||manifest.items.length>500)throw Error('Invalid planning manifest');
 const actor=db.sqlite.prepare('SELECT u.id,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.trip_id=? AND u.disabled=0').get(actorId,TRIP);
 if(!actor||!['owner','admin','editor'].includes(actor.role))throw Error('An existing active editor/admin actor is required');
 const entries=new Map();for(const item of manifest.items){if(!item||!/^[-a-z0-9]{1,100}$/.test(item.key)||entries.has(item.key))throw Error('Invalid or duplicate key');entries.set(item.key,item)}
 const ids=new Map([...entries.keys()].map(key=>[key,'plan-'+createHash('sha256').update(manifest.namespace+':'+key).digest('hex').slice(0,24)]));
 const ordered=[],visiting=new Set(),done=new Set();
 function visit(key){if(visiting.has(key))throw Error('Dependency cycle');if(done.has(key))return;if(!entries.has(key))throw Error('Missing dependency: '+key);visiting.add(key);for(const dep of entries.get(key).dependencies||[])visit(dep);visiting.delete(key);done.add(key);ordered.push(entries.get(key))}
 for(const key of entries.keys())visit(key);
 let created=0,skipped=0;
 for(const entry of ordered){
  const id=ids.get(entry.key);if(db.sqlite.prepare('SELECT 1 FROM planning_items WHERE id=? AND trip_id=?').get(id,TRIP)||db.sqlite.prepare("SELECT 1 FROM planning_events WHERE trip_id=? AND action='delete' AND json_extract(payload,'$.before.id')=?").get(TRIP,id)){skipped++;continue}
  const {key,...payload}=entry;payload.dependencies=(entry.dependencies||[]).map(key=>ids.get(key));
  const request=new Request('https://internal.invalid/api/planning/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const response=await handlePlanning(request,db,actor,{creationId:id});if(response.status!==201)throw Error(JSON.stringify(await response.json()));created++;
 }
 db.sqlite.prepare('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('planning-import:'+manifest.namespace,JSON.stringify({created,skipped,at:Date.now(),actor:actor.id}));
 return {created,skipped,ids:Object.fromEntries(ids)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [file,input,actor]=process.argv.slice(2);if(!file||!input||!actor||!existsSync(file))throw Error('Usage: node server/import-planning.mjs EXISTING_DATABASE MANIFEST ACTOR_ID');
 const db=openDatabase(file);try{
  const directory=resolve(dirname(file),'planning-backups');mkdirSync(directory,{recursive:true,mode:0o700});
  const snapshot=resolve(directory,'before-import-'+Date.now()+'.sqlite');db.sqlite.exec("VACUUM INTO '"+snapshot.replaceAll("'","''")+"'");chmodSync(snapshot,0o600);
  const result=await importPlanning(db,JSON.parse(readFileSync(input,'utf8')),actor);console.log(JSON.stringify({backup:snapshot,...result}));
 }finally{db.close()}
}
