import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync, renameSync, rmSync, existsSync, realpathSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transaction, run } from '../src/sqlite.mjs';
import { createDocumentStorage, documentHash, detectDocumentMime } from './document-storage.mjs';
import { openDatabase } from './database.mjs';

const verifyDB=db=>{
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').get())throw new Error('Backup database integrity failed');
};
function durableWrite(path,bytes){writeFileSync(path,bytes,{mode:0o600,flag:'wx'});const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function syncDirectory(path){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
const manifestRows=db=>db.prepare("SELECT id,trip_id,storage_key,sha256,byte_size,detected_mime FROM document_assets WHERE status='ready' ORDER BY id").all().map(r=>({...r}));
function validateManifest(db,manifest){
  verifyDB(db);
  if(manifest.schema_version!==1||JSON.stringify(manifest.assets)!==JSON.stringify(manifestRows(db)))throw new Error('Asset manifest does not match database');
  if(db.prepare("SELECT 1 FROM documents d JOIN document_assets a ON a.id=d.asset_id WHERE a.status<>'ready' LIMIT 1").get())throw new Error('Referenced asset is not ready');
}
export async function backupDocuments(db,store,outputDirectory,{now=Date.now()}={}){
  const directory=resolve(outputDirectory),lease=crypto.randomUUID();
  mkdirSync(directory,{mode:0o700});
  writeFileSync(join(directory,'INCOMPLETE'),'Backup not verified\n',{mode:0o600});
  transaction(db,()=>run(db,'INSERT INTO document_storage_leases VALUES(?,?)',lease,now+3600000));
  let snapshot;
  try{
    const file=join(directory,'database.sqlite');await backup(db.sqlite,file);chmodSync(file,0o600);
    snapshot=new DatabaseSync(file,{readOnly:true});
    const manifest={schema_version:1,created_at:now,assets:manifestRows(snapshot)};
    validateManifest(snapshot,manifest);
    const destination=createDocumentStorage(join(directory,'documents'));
    for(const asset of manifest.assets){
      const checked=store.inspect({...asset,status:'ready'},{includeBytes:true});if(checked.availability!=='ready')throw new Error('Backup asset unavailable: '+asset.id);
      durableWrite(destination.path('assets',asset.storage_key),checked.bytes);
      if(destination.inspect({...asset,status:'ready'}).availability!=='ready')throw new Error('Copied asset failed verification');
    }
    snapshot.close();snapshot=null;
    manifest.database_sha256=documentHash(readFileSync(file));
    durableWrite(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    if(Date.now()>now+3600000)throw new Error('Backup lease expired; repeat backup');
    syncDirectory(join(directory,'documents','assets'));rmSync(join(directory,'INCOMPLETE'));syncDirectory(directory);
    return {assets:manifest.assets.length,bytes:manifest.assets.reduce((n,a)=>n+a.byte_size,0),verified:true};
  }finally{snapshot?.close();transaction(db,()=>run(db,'DELETE FROM document_storage_leases WHERE id=?',lease));}
}
export function restoreDocuments(backupDirectory,outputDirectory){
  const source=resolve(backupDirectory),output=resolve(outputDirectory);
  if(existsSync(output))throw new Error('Restore destination must be new');
  if(existsSync(join(source,'INCOMPLETE')))throw new Error('Backup is incomplete');
  const manifest=JSON.parse(readFileSync(join(source,'manifest.json'),'utf8')),dbFile=join(source,'database.sqlite');
  if(documentHash(readFileSync(dbFile))!==manifest.database_sha256)throw new Error('Backup database hash mismatch');
  const snapshot=new DatabaseSync(dbFile,{readOnly:true});
  try{validateManifest(snapshot,manifest);}finally{snapshot.close();}
  // Verify source bytes before creating a usable destination. Never overwrite a live database.
  const files=manifest.assets.map(a=>{
    if(!/^[a-f0-9-]{36}$/.test(a.storage_key))throw new Error('Invalid manifest storage key');
    const bytes=readFileSync(join(source,'documents','assets',a.storage_key));
    if(bytes.length!==a.byte_size||documentHash(bytes)!==a.sha256||detectDocumentMime(bytes)!==a.detected_mime)throw new Error('Backup asset hash/type mismatch');
    return a;
  });
  const temporary=output+'.restoring-'+crypto.randomUUID();mkdirSync(temporary,{mode:0o700});let db;
  try{
    copyFileSync(dbFile,join(temporary,'database.sqlite'));chmodSync(join(temporary,'database.sqlite'),0o600);
    const store=createDocumentStorage(join(temporary,'documents'));
    for(const asset of files)durableWrite(store.path('assets',asset.storage_key),readFileSync(join(source,'documents','assets',asset.storage_key)));
    db=openDatabase(join(temporary,'database.sqlite'));
    transaction(db,()=>{
      run(db,"UPDATE document_uploads SET status='expired',lease_until=NULL WHERE status IN ('pending','receiving','uploaded')");
      run(db,'DELETE FROM document_storage_leases');
    });
    validateManifest(db.sqlite,manifest);
    for(const a of manifest.assets)if(store.inspect({...a,status:'ready'}).availability!=='ready')throw new Error('Restored asset verification failed');
    db.close();db=null;
    writeFileSync(join(temporary,'restore-report.json'),JSON.stringify({assets:files.length,verified:true,pending_uploads_expired:true})+'\n',{mode:0o600});
    syncDirectory(join(temporary,'documents','assets'));syncDirectory(temporary);
    renameSync(temporary,output);return {assets:files.length,verified:true};
  }catch(e){db?.close();rmSync(temporary,{recursive:true,force:true});throw e;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [action,source,storageOrDestination,destination]=process.argv.slice(2);
  if(action==='backup'&&source&&storageOrDestination&&destination){
    const db=openDatabase(realpathSync(source));
    try{console.log(JSON.stringify(await backupDocuments(db,createDocumentStorage(storageOrDestination),destination)));}finally{db.close();}
  }else if(action==='restore'&&source&&storageOrDestination)console.log(JSON.stringify(restoreDocuments(source,storageOrDestination)));
  else throw new Error('Usage: document-backup.mjs backup DATABASE DOCUMENT_ROOT NEW_DIRECTORY | restore BACKUP NEW_DIRECTORY');
}
