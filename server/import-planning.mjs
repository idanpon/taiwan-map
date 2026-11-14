import { readFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { openDatabase } from './database.mjs';
import { applyPlanningChange } from '../src/planning.mjs';
import { transaction } from '../src/sqlite.mjs';
import { TRIP } from '../src/auth.mjs';
import { planningModel, problem } from '../src/planning-domain-store.mjs';
import { createChangeset,getChangeset,previewChangeset,applyChangeset } from '../src/planning-command-service.mjs';
import { one,run } from '../src/sqlite.mjs';
import {createDocumentStorage} from './document-storage.mjs';
import {backupDocuments} from './document-backup.mjs';

// A stable manifest ID identifies one operation, not a sequence of reimports.
// Never fold preview and apply into one call for model 3.
export function previewPlanningImport(db,manifest,actorId){
 if(!manifest||manifest.schema_version!==3||!/^[-a-zA-Z0-9]{1,100}$/.test(manifest.id)||!Array.isArray(manifest.commands)||Object.keys(manifest).some(k=>!['schema_version','id','commands'].includes(k)))throw Error('Expected model 3 command manifest with a stable id');
 return transaction(db,()=>{
  const key='planning-import-v3:'+manifest.id,hash=createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),old=one(db,'SELECT value FROM app_meta WHERE key=?',key),record=old?JSON.parse(old.value):null;
  if(record&&record.hash!==hash)throw Error('Manifest changed: use a new stable id');
  const actor={id:actorId};let draft;
  if(record)draft=getChangeset(db,actor,record.changeset_id);else{draft=createChangeset(db,actor,{version:3,commands:manifest.commands});run(db,'INSERT INTO app_meta(key,value) VALUES(?,?)',key,JSON.stringify({hash,changeset_id:draft.id,actor_id:actorId}));}
  if(draft.result)return {manifest_id:manifest.id,...draft};
  return {manifest_id:manifest.id,...previewChangeset(db,actor,draft.id,{version:draft.version})};
 });
}
export function applyPlanningImport(db,receipt,actorId){
 if(!receipt||receipt.confirmed!==true)throw Error('Explicit confirmation of this import preview is required');
 return applyChangeset(db,{id:actorId},receipt.id,{version:receipt.version,fingerprint:receipt.fingerprint,idempotency_key:'import:'+receipt.id,acknowledgements:receipt.acknowledgements||[]});
}
export async function importPlanning(db, manifest, actorId) {
  if (
    !manifest ||
    !/^[-a-z0-9]{1,100}$/.test(manifest.namespace) ||
    !Array.isArray(manifest.items) ||
    manifest.items.length > 500
  )
    throw Error('Invalid planning manifest');
  const actor = db.sqlite
    .prepare(
      'SELECT u.id,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.trip_id=? AND u.disabled=0',
    )
    .get(actorId, TRIP);
  if (!actor || !['owner', 'admin', 'editor'].includes(actor.role))
    throw Error('An existing active editor/admin actor is required');
  if (planningModel(db) === 3)
    problem(409, 'MODEL3_IMPORT_REQUIRED', 'Старый формат импорта не поддерживает новую модель. Используйте общий сервис changesets.');
  const entries = new Map();
  for (const item of manifest.items) {
    if (!item || !/^[-a-z0-9]{1,100}$/.test(item.key) || entries.has(item.key))
      throw Error('Invalid or duplicate key');
    entries.set(item.key, item);
  }
  const ids = new Map(
    [...entries.keys()].map((key) => [
      key,
      'plan-' +
        createHash('sha256')
          .update(manifest.namespace + ':' + key)
          .digest('hex')
          .slice(0, 24),
    ]),
  );
  const ordered = [],
    visiting = new Set(),
    done = new Set();
  function visit(key) {
    if (visiting.has(key)) throw Error('Dependency cycle');
    if (done.has(key)) return;
    if (!entries.has(key)) throw Error('Missing dependency: ' + key);
    visiting.add(key);
    for (const dep of entries.get(key).dependencies || []) visit(dep);
    visiting.delete(key);
    done.add(key);
    ordered.push(entries.get(key));
  }
  for (const key of entries.keys()) visit(key);
  return transaction(db, () => {
    let created = 0,
      skipped = 0;
    for (const entry of ordered) {
      const id = ids.get(entry.key);
      if (
        db.sqlite.prepare('SELECT 1 FROM planning_items WHERE id=? AND trip_id=?').get(id, TRIP) ||
        db.sqlite
          .prepare(
            "SELECT 1 FROM planning_events WHERE trip_id=? AND action='delete' AND json_extract(payload,'$.before.id')=?",
          )
          .get(TRIP, id)
      ) {
        skipped++;
        continue;
      }
      const { key, ...payload } = entry;
      payload.dependencies = (entry.dependencies || []).map((key) => ids.get(key));
      applyPlanningChange(db, actor, {
        path: '/api/planning/items',
        method: 'POST',
        body: payload,
        creationId: id,
      });
      created++;
    }
    db.sqlite
      .prepare(
        'INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(
        'planning-import:' + manifest.namespace,
        JSON.stringify({ created, skipped, at: Date.now(), actor: actor.id }),
      );
    return { created, skipped, ids: Object.fromEntries(ids) };
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, input, actor,mode] = process.argv.slice(2);
  if (!file || !input || !actor || !existsSync(file))
    throw Error('Usage: node server/import-planning.mjs EXISTING_DATABASE MANIFEST_OR_CONFIRMATION ACTOR_ID [--apply]');
  const db = openDatabase(file);
  try {
    const manifest=JSON.parse(readFileSync(input,'utf8'));
    if(mode&&mode!=='--apply')throw Error('Unknown import mode');
    let snapshot=null;
    if(mode==='--apply'||manifest.schema_version!==3){
      const directory=resolve(dirname(file),'planning-backups');mkdirSync(directory,{recursive:true,mode:0o700});
      snapshot=resolve(directory,'before-import-'+Date.now()+(planningModel(db)===3?'.bundle':'.sqlite'));
      if(planningModel(db)===3){db.documentStore=createDocumentStorage(process.env.DOCUMENT_ROOT||resolve(dirname(file),'documents'));await backupDocuments(db,db.documentStore,snapshot);}
      else{db.sqlite.exec("VACUUM INTO '"+snapshot.replaceAll("'","''")+"'");chmodSync(snapshot,0o600);}
    }
    const result=mode==='--apply'?applyPlanningImport(db,manifest,actor):manifest.schema_version===3?previewPlanningImport(db,manifest,actor):await importPlanning(db,manifest,actor);
    console.log(JSON.stringify({backup:snapshot,...result}));
  } finally {
    db.close();
  }
}
