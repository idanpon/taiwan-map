import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, migrate } from './database.mjs';
import { upgradePlanningModel } from '../src/planning-upgrade.mjs';
import { fingerprint, sourceTables } from '../src/planning-domain-store.mjs';
import { TRIP } from '../src/auth.mjs';

export function databaseInventory(sqlite) {
  return sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>{
    const quoted='"'+name.replaceAll('"','""')+'"';
    const columns=sqlite.prepare('PRAGMA table_info('+quoted+')').all().map(c=>c.name);
    const rows=sqlite.prepare('SELECT * FROM '+quoted).all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return {name,columns,rows};
  });
}
function preservesInventory(before, sqlite, { conversion = false } = {}) {
  const addedTables=new Set([...Object.values(sourceTables).filter(t=>t!=='planning_items'),'planning_migration_refs','planning_changesets','planning_operations','planning_event_refs']);
  return before.every(t=>{
    const quoted='"'+t.name.replaceAll('"','""')+'"';
    const allowed=!conversion?[]:t.name==='trips'?['planning_model','planning_revision']:t.name==='planning_items'?['activation_scope_id','task_activation','decision_mode']:[];
    const columns=t.columns.filter(c=>!allowed.includes(c));
    const oldRows=t.rows.map(row=>Object.fromEntries(columns.map(c=>[c,row[c]]))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    let rows=sqlite.prepare('SELECT '+columns.map(c=>'"'+c.replaceAll('"','""')+'"').join(',')+' FROM '+quoted).all();
    if(t.name==='planning_events'&&conversion)rows=rows.filter(r=>t.rows.some(old=>old.id===r.id));
    if(t.name==='_app_migrations')rows=rows.filter(r=>t.rows.some(old=>old.name===r.name));
    if(conversion&&addedTables.has(t.name))return oldRows.every(row=>rows.some(candidate=>fingerprint(candidate)===fingerprint(row)));
    rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return fingerprint(rows)===fingerprint(oldRows);
  });
}
// Read-only source + SQLite backup. Destination must be a new directory.
// Never substitutes an export/seed for a production backup.
export async function rehearsePlanningUpgrade(sourceFile, outputDirectory, actorId) {
  const source=realpathSync(sourceFile), directory=resolve(outputDirectory);
  mkdirSync(directory,{mode:0o700});
  const sqlite=new DatabaseSync(source,{readOnly:true});
  let copy;
  try {
    const before=databaseInventory(sqlite), sourceHash=fingerprint(before), file=join(directory,'upgraded.sqlite');
    await backup(sqlite,file);chmodSync(file,0o600);
    copy=openDatabase(file);
    migrate(copy,resolve(dirname(fileURLToPath(import.meta.url)),'../drizzle'));
    const originalModel=before.find(t=>t.name==='trips')?.rows.find(row=>row.id===TRIP)?.planning_model??2;
    const schemaModel=copy.sqlite.prepare('SELECT planning_model FROM trips WHERE id=?').get(TRIP)?.planning_model;
    const schemaPreserved=preservesInventory(before,copy.sqlite);
    if(!schemaPreserved||schemaModel!==originalModel)throw new Error('SQL migration changed existing data or activated a different planning model');
    const result=upgradePlanningModel(copy,{id:actorId});
    const preserved=preservesInventory(before,copy.sqlite,{conversion:true});
    const fk=copy.sqlite.prepare('PRAGMA foreign_key_check').all();
    const integrity=copy.sqlite.prepare('PRAGMA integrity_check').get().integrity_check;
    const repeat=upgradePlanningModel(copy,{id:actorId});
    const sourceUnchanged=sourceHash===fingerprint(databaseInventory(sqlite));
    if(!preserved||fk.length||integrity!=='ok'||!repeat.already_upgraded||!sourceUnchanged)
      throw new Error('Planning upgrade rehearsal failed preservation/integrity checks');
    const report={model:3,schema_rows_preserved:schemaPreserved,schema_model:schemaModel,source_unchanged:sourceUnchanged,legacy_rows_preserved:preserved,foreign_key_errors:fk.length,integrity,repeat_idempotent:repeat.already_upgraded,...result};
    writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
    return report;
  } finally {copy?.close();sqlite.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [source,output,actor]=process.argv.slice(2);
  if(!source||!output||!actor)throw new Error('Usage: node server/rehearse-planning-upgrade.mjs SOURCE.sqlite NEW_OUTPUT_DIRECTORY ACTOR_ID');
  console.log(JSON.stringify(await rehearsePlanningUpgrade(source,output,actor),null,2));
}
