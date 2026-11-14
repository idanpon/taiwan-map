import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, mkdirSync, copyFileSync, renameSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { backup } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openDatabase, migrate } from '../server/database.mjs';
import { createDocumentStorage, documentHash } from '../server/document-storage.mjs';
import { backupDocuments, restoreDocuments } from '../server/document-backup.mjs';
import { startDocumentUpload, receiveDocumentUpload, finalizeDocumentUpload, discardDocumentUpload, collectDocumentGarbage, documentRegistry } from '../src/documents.mjs';
import { seed } from '../src/seed.mjs';
import { TRIP, sha } from '../src/auth.mjs';
import { run, all, one } from '../src/sqlite.mjs';
import { upgradePlanningModel } from '../src/planning-upgrade.mjs';
import { readModel3, createChangeset, previewChangeset, applyChangeset } from '../src/planning-command-service.mjs';
import { readSources, fingerprint } from '../src/planning-domain-store.mjs';
import { bookingRegistry } from '../src/planning-bookings.mjs';
import { handle } from '../src/core.mjs';
import { applyPlanningChange } from '../src/planning.mjs';

const PDF=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1N8AAAAASUVORK5CYII=','base64');
const ref=(command,entity)=>({command,entity}),code=c=>e=>e.details?.code===c;
const create=(key,asset,title='Ticket')=>({key,type:'create_document',data:{kind:'file',asset_id:asset.id,title}});
const attach=(key,document,booking,service=null)=>({key,type:'attach_document',expected_version:0,document_id:document,booking_id:booking,service_id:service});
async function fixture(t,limits={}){
  const dir=mkdtempSync(join(tmpdir(),'taiwan-documents-')),db=openDatabase(join(dir,'source.sqlite'));migrate(db,'drizzle');await seed(db);
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  db.documentStore=createDocumentStorage(join(dir,'private'),limits);
  run(db,"INSERT INTO app_meta(key,value) VALUES('accounts_v1','shared')");
  const users={},tokens={};
  for(const [id,role,n] of [['editor','editor','1'],['other','editor','2'],['viewer','viewer','3'],['admin','admin','4']]){
    run(db,'INSERT INTO users(id,display_name,created_at) VALUES(?,?,1)',id,id);run(db,'INSERT INTO memberships VALUES(?,?,?)',TRIP,id,role);
    users[id]={id,role};tokens[id]=n.repeat(64);run(db,'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',await sha(tokens[id]),id,Date.now()+86400000);
  }
  upgradePlanningModel(db,users.editor);
  const api=(path,{user='editor',method='GET',data,bytes,headers={}}={})=>handle(new Request('https://example.test'+path,{method,headers:{Origin:'https://example.test',...(user?{Authorization:'Bearer '+tokens[user]}:{}),'Content-Type':bytes?'application/octet-stream':'application/json',...headers},...(data!==undefined?{body:JSON.stringify(data)}:bytes?{body:bytes}:{})}),{DB:db,APP_ORIGIN:'https://example.test',AUTH_MODE:'bearer'});
  const preview=(commands,actor=users.editor)=>{const d=createChangeset(db,actor,{version:3,commands});return previewChangeset(db,actor,d.id,{version:d.version});};
  const apply=(p,actor=users.editor)=>applyChangeset(db,actor,p.id,{version:p.version,fingerprint:p.preview.fingerprint,idempotency_key:'test-'+p.id,acknowledgements:p.preview.allowed_acknowledgements});
  const write=commands=>{const p=preview(commands);assert.equal(p.preview.can_apply,true);apply(p);return p.preview.resolved_ids;};
  const row=(table,id)=>one(db,'SELECT * FROM '+table+' WHERE id=?',id);
  const start=(bytes=PDF,data={},actor=users.editor,now=Date.now())=>startDocumentUpload(db,actor,{original_name:'Билет.pdf',byte_size:bytes.length,sha256:documentHash(bytes),mime:'application/pdf',...data},now);
  const upload=async(bytes=PDF,data={},actor=users.editor)=>{
    const u=start(bytes,data,actor);await receiveDocumentUpload(db,actor,u.id,new Request('https://example.test',{method:'POST',body:bytes}));return finalizeDocumentUpload(db,actor,u.id).asset;
  };
  const booking=()=>write([{key:'booking',type:'record_booking',data:{category:'rail',reference:'Private supplier number'}}]).booking.booking;
  const publish=(asset,book=booking())=>{const ids=write([create('doc',asset),attach('link',ref('doc','document'),book)]);return {id:ids.doc.document,link:ids.link.link,book};};
  return {dir,db,users,tokens,api,preview,apply,write,row,start,upload,booking,publish};
}

test('private upload becomes shared only through an atomic binding; read and export omit private storage and other uploads',async t=>{
  const f=await fixture(t),asset=await f.upload(),private2=await f.upload(PDF,{},f.users.other);
  const before=readModel3(f.db,f.users.viewer);assert.equal(before.sources.documents.length,0);assert.equal(before.sources.document_assets.length,0);
  assert.throws(()=>f.preview([create('doc',private2),attach('l',ref('doc','document'),f.booking())]),code('ASSET_UNAVAILABLE'));
  const doc=f.publish(asset);
  for(const user of ['editor','other','admin','viewer']){
    const response=await f.api('/api/documents/'+doc.id+'/content',{user});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),PDF);
    assert.equal(response.headers.get('cache-control'),'private, no-store');assert.match(response.headers.get('content-disposition'),/^attachment;.*filename\*=UTF-8''/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  }
  const exportResponse=await f.api('/api/export',{user:'viewer'}),text=await exportResponse.text();
  assert.equal(exportResponse.status,200);assert(!text.includes(private2.id));assert(!text.includes('storage_key'));assert(!text.includes('document_uploads'));assert(text.includes(doc.id));assert(!text.includes(PDF.toString()));
  const registry=bookingRegistry(f.db,f.users.viewer,doc.book);assert.equal(registry.bookings[0].documents[0].document.asset.availability,'ready');
  assert(!JSON.stringify(documentRegistry(f.db,f.users.viewer)).includes('storage_key'));
});

test('every content, range and HEAD request rechecks authentication and membership, including a revoked editor',async t=>{
  const f=await fixture(t),doc=f.publish(await f.upload());
  assert.equal((await f.api('/api/documents/'+doc.id+'/content',{user:null})).status,401);
  assert.equal((await f.api('/api/documents/'+doc.id+'/content',{user:'viewer',headers:{Range:'bytes=0-3'}})).status,206);
  run(f.db,"DELETE FROM memberships WHERE user_id='viewer'");
  for(const method of ['GET','HEAD'])assert([401,403].includes((await f.api('/api/documents/'+doc.id+'/content',{user:'viewer',method,headers:{Range:'bytes=0-3'}})).status));
  run(f.db,"UPDATE users SET disabled=1 WHERE id='other'");
  assert([401,403].includes((await f.api('/api/documents/'+doc.id+'/content',{user:'other'})).status));
  const u=f.start();run(f.db,"UPDATE memberships SET role='viewer' WHERE user_id='editor'");
  await assert.rejects(()=>receiveDocumentUpload(f.db,f.users.editor,u.id,new Request('https://example.test',{method:'POST',body:PDF})),code('PLANNING_ACCESS_DENIED'));
});

test('viewer cannot upload or mutate bindings, editors cannot inspect or finish each other staging uploads',async t=>{
  const f=await fixture(t),u=f.start();
  assert.throws(()=>f.start(PDF,{},f.users.viewer),code('PLANNING_ACCESS_DENIED'));
  for(const suffix of ['', '/finalize']){
    const r=await f.api('/api/documents/uploads/'+u.id+suffix,{user:'other',method:suffix?'POST':'GET',...(suffix?{data:{}}:{})});assert.equal(r.status,404);
  }
  assert.throws(()=>finalizeDocumentUpload(f.db,f.users.other,u.id),code('UPLOAD_UNAVAILABLE'));
  assert.throws(()=>createChangeset(f.db,f.users.viewer,{version:3,commands:[create('d',{id:'unknown'})]}),code('PLANNING_ACCESS_DENIED'));
  const cross=await f.api('/api/documents/uploads',{method:'POST',data:{},headers:{Origin:'https://evil.example'}});assert.equal(cross.status,403);
});

test('upload enforces declared and actual size, hash and MIME instead of trusting the name or content type',async t=>{
  const f=await fixture(t,{maxBytes:1024,quotaBytes:8192});
  for(const name of ['../ticket.pdf','a\\b.pdf','bad\r\n.pdf','bad\ud800.pdf'])assert.throws(()=>f.start(PDF,{original_name:name}),code('INVALID_FILENAME'));
  assert.throws(()=>f.start(PDF,{byte_size:1025}),code('UPLOAD_TOO_LARGE'));
  for(const [bytes,data,expected] of [[PDF,{sha256:'0'.repeat(64)},'UPLOAD_HASH_MISMATCH'],[Buffer.from('<html>not a pdf</html>'),{},'UPLOAD_TYPE_MISMATCH'],[PNG,{mime:'application/pdf'},'UPLOAD_TYPE_MISMATCH']]){
    const u=f.start(bytes,data);await receiveDocumentUpload(f.db,f.users.editor,u.id,new Request('https://example.test',{method:'POST',body:bytes}));assert.throws(()=>finalizeDocumentUpload(f.db,f.users.editor,u.id),code(expected));
  }
  const u=f.start();await assert.rejects(()=>receiveDocumentUpload(f.db,f.users.editor,u.id,new Request('https://example.test',{method:'POST',body:Buffer.concat([PDF,PDF])})),code('UPLOAD_TOO_LARGE'));assert.equal(f.row('document_uploads',u.id).status,'failed');
  const short=f.start();await assert.rejects(()=>receiveDocumentUpload(f.db,f.users.editor,short.id,new Request('https://example.test',{method:'POST',body:PDF.subarray(0,10)})),code('UPLOAD_SIZE_MISMATCH'));
  assert.equal((await f.upload(PNG,{mime:'image/png',original_name:'QR.png'})).detected_mime,'image/png');
});

test('parallel reservations count against quota and concurrent writes to the same upload cannot race',async t=>{
  const f=await fixture(t,{maxBytes:1024,quotaBytes:1024}),u=f.start(PDF,{byte_size:600});
  assert.throws(()=>f.start(PDF,{byte_size:600}),code('DOCUMENT_QUOTA_EXCEEDED'));
  let controller;const stream=new ReadableStream({start(c){controller=c;}});
  const pending=receiveDocumentUpload(f.db,f.users.editor,u.id,new Request('https://example.test',{method:'POST',body:stream,duplex:'half'}));
  await assert.rejects(()=>receiveDocumentUpload(f.db,f.users.editor,u.id,new Request('https://example.test',{method:'POST',body:PDF})),code('UPLOAD_STATE'));
  controller.error(new Error('Connection interrupted'));await assert.rejects(pending,/Connection interrupted/);
  assert.equal(f.row('document_uploads',u.id).status,'failed');assert.equal(readdirSync(join(f.dir,'private','staging')).length,0);
  assert(f.start(PDF,{byte_size:600}).id);
});

test('revocation while content streams prevents finalization and never publishes bytes',async t=>{
  const f=await fixture(t),u=f.start();let controller;const stream=new ReadableStream({start(c){controller=c;}});
  const pending=receiveDocumentUpload(f.db,f.users.editor,u.id,new Request('https://example.test',{method:'POST',body:stream,duplex:'half'}));
  run(f.db,"DELETE FROM memberships WHERE user_id='editor'");controller.enqueue(PDF);controller.close();
  await assert.rejects(pending,code('PLANNING_ACCESS_DENIED'));assert.equal(f.row('document_uploads',u.id).status,'failed');assert.equal(all(f.db,'SELECT * FROM document_assets').length,0);
});

test('finalize recovers a rename-before-database failure and is idempotent without duplicating quota',async t=>{
  const f=await fixture(t),u=f.start();await receiveDocumentUpload(f.db,f.users.editor,u.id,new Request('https://example.test',{method:'POST',body:PDF}));
  f.db.sqlite.exec("CREATE TRIGGER fail_ready BEFORE INSERT ON document_assets BEGIN SELECT RAISE(ABORT,'simulated crash'); END");
  assert.throws(()=>finalizeDocumentUpload(f.db,f.users.editor,u.id),/simulated crash/);assert.equal(f.row('document_uploads',u.id).status,'uploaded');
  assert.equal(readdirSync(join(f.dir,'private','staging')).length,0);assert.equal(readdirSync(join(f.dir,'private','assets')).length,1);
  f.db.sqlite.exec('DROP TRIGGER fail_ready');const a=finalizeDocumentUpload(f.db,f.users.editor,u.id).asset;
  assert.equal(finalizeDocumentUpload(f.db,f.users.editor,u.id).asset.id,a.id);assert.equal(all(f.db,'SELECT * FROM document_assets').length,1);
});

test('single byte ranges, suffixes, HEAD and invalid ranges preserve safe download headers',async t=>{
  const f=await fixture(t),doc=f.publish(await f.upload());
  for(const [range,start,end] of [['bytes=0-3',0,4],['bytes=4-',4,PDF.length],['bytes=-5',PDF.length-5,PDF.length],['bytes=0-999',0,PDF.length]]){
    const r=await f.api('/api/documents/'+doc.id+'/content',{headers:{Range:range}});assert.equal(r.status,206);assert.deepEqual(Buffer.from(await r.arrayBuffer()),PDF.subarray(start,end));assert.equal(r.headers.get('content-range'),'bytes '+start+'-'+(end-1)+'/'+PDF.length);
  }
  for(const range of ['bytes=999-','bytes=1-0','bytes=-0','bytes=0-1,4-5','items=0-1','bytes=-','bytes=-9999999999999999999999']){
    const r=await f.api('/api/documents/'+doc.id+'/content',{headers:{Range:range}});assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */'+PDF.length);
  }
  const head=await f.api('/api/documents/'+doc.id+'/content',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(Number(head.headers.get('content-length')),PDF.length);
  const cors=await f.api('/api/documents/'+doc.id+'/content',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization,range'}});assert.equal(cors.status,204);
});

test('missing, corrupted or symlinked bytes become unavailable while booking metadata survives',async t=>{
  const f=await fixture(t),a=await f.upload(),doc=f.publish(a),row=f.row('document_assets',a.id),path=f.db.documentStore.path('assets',row.storage_key);
  writeFileSync(path,Buffer.alloc(PDF.length));assert.equal(documentRegistry(f.db,f.users.viewer,doc.id).documents[0].availability,'unavailable');assert.equal((await f.api('/api/documents/'+doc.id+'/content')).status,410);
  rmSync(path);assert.equal(readModel3(f.db,f.users.editor).sources.document_assets[0].availability,'unavailable');
  const secret=join(f.dir,'outside.txt');writeFileSync(secret,PDF);symlinkSync(secret,path);assert.equal((await f.api('/api/documents/'+doc.id+'/content')).status,410);
  assert.equal(f.row('bookings',doc.book).reference,'Private supplier number');
});

test('document replacement retains history and bytes, while detach and cancellation never delete supplier documents',async t=>{
  const f=await fixture(t),old=f.publish(await f.upload()),newAsset=await f.upload(PNG,{mime:'image/png',original_name:'new.png'});
  const ids=f.write([{key:'new',type:'replace_document',id:old.id,expected_version:f.row('documents',old.id).version,data:{kind:'file',asset_id:newAsset.id,title:'Updated ticket'},reason:'Supplier reissued'}]);
  const newer=ids.new.document;assert.equal(f.row('documents',newer).replaces_document_id,old.id);assert(f.row('documents',old.id).archived_at);
  assert.equal((await f.api('/api/documents/'+old.id+'/content',{user:'viewer'})).status,200);
  const binding=one(f.db,'SELECT * FROM booking_documents WHERE document_id=? AND archived_at IS NULL',newer);
  f.write([{key:'detach',type:'detach_document',id:binding.id,expected_version:binding.version,reason:'Keep historical file'}]);
  assert.equal((await f.api('/api/documents/'+newer+'/content',{user:'viewer'})).status,200);
  assert(documentRegistry(f.db,f.users.viewer,old.id,{history:true}).events.some(e=>e.payload.commands.some(c=>c.type==='replace_document')));
  assert(bookingRegistry(f.db,f.users.viewer,old.book,{history:true}).events.some(e=>e.payload.commands.some(c=>c.type==='detach_document')));
  collectDocumentGarbage(f.db,{now:Date.now()+3*86400000});assert.equal(readdirSync(join(f.dir,'private','assets')).length,2);
});

test('external links are shared metadata, never fetched or substituted for bytes; unsafe URLs are rejected',async t=>{
  const f=await fixture(t),b=f.booking();
  for(const url of ['javascript:alert(1)','data:text/html,x','https://user:pass@example.test/a','file:///etc/passwd','https://example.test/ bad']){
    assert.throws(()=>f.preview([{key:'d',type:'create_document',data:{kind:'link',title:'QR',external_url:url}},attach('l',ref('d','document'),b)]),code('INVALID_DOCUMENT_URL'));
  }
  const ids=f.write([{key:'d',type:'create_document',data:{kind:'link',title:'QR link',external_url:'https://supplier.invalid/qr?token=private'}},attach('l',ref('d','document'),b)]);
  assert.equal(documentRegistry(f.db,f.users.viewer,ids.d.document).documents[0].availability,'external');
  assert.equal((await f.api('/api/documents/'+ids.d.document+'/content')).status,409);
  const publicText=await(await f.api('/api/public/data',{user:null})).text();assert(!publicText.includes('supplier.invalid'));
});

test('changeset binding validates owner and booking/service IDs and atomically rolls back late SQL failure',async t=>{
  const f=await fixture(t),asset=await f.upload(),a=f.booking(),b=f.booking();
  const service=f.write([{key:'s',type:'add_service',booking_id:a,data:{kind:'admission',state:'confirmed',title:'Ticket',validity:'unknown'}}]).s.service;
  assert.throws(()=>f.preview([create('d',asset),attach('l',ref('d','document'),b,service)]),code('DOCUMENT_BOOKING_MISMATCH'));
  assert.throws(()=>f.preview([create('d',asset)]),code('DOCUMENT_BINDING_REQUIRED'));
  const p=f.preview([create('d',asset),attach('l',ref('d','document'),a,service)]),before=fingerprint(readSources(f.db));
  f.db.sqlite.exec("CREATE TRIGGER reject_binding BEFORE INSERT ON booking_documents BEGIN SELECT RAISE(ABORT,'late document failure'); END");
  assert.throws(()=>f.apply(p),/late document failure/);assert.equal(fingerprint(readSources(f.db)),before);assert.equal(all(f.db,'SELECT * FROM documents').length,0);assert.equal(f.row('document_assets',asset.id).status,'ready');
  f.db.sqlite.exec('DROP TRIGGER reject_binding');const receipt=f.apply(p);assert.deepEqual(f.apply(p),receipt);
});

test('stale, expired or damaged private assets cannot be attached through an old preview',async t=>{
  const f=await fixture(t),asset=await f.upload(),b=f.booking(),expiry=Date.now()+60000;
  run(f.db,'UPDATE document_uploads SET expires_at=? WHERE id=?',expiry,asset.id);
  const p=f.preview([create('d',asset),attach('l',ref('d','document'),b)]);assert.equal(p.expires_at,expiry);
  run(f.db,'UPDATE document_uploads SET expires_at=1 WHERE id=?',asset.id);assert.throws(()=>f.apply(p),code('ASSET_UNAVAILABLE'));assert.equal(all(f.db,'SELECT * FROM documents').length,0);
  run(f.db,'UPDATE document_uploads SET expires_at=? WHERE id=?',Date.now()+86400000,asset.id);
  const raw=f.row('document_assets',asset.id);writeFileSync(f.db.documentStore.path('assets',raw.storage_key),Buffer.alloc(PDF.length));assert.throws(()=>f.apply(p),code('ASSET_UNAVAILABLE'));
});

test('service split requires explicit document mapping; cancellation preserves linked files and replacement does not guess new applicability',async t=>{
  const f=await fixture(t),b=f.booking(),asset=await f.upload();
  const ids=f.write([{key:'s',type:'add_service',booking_id:b,data:{kind:'admission',state:'confirmed',title:'Group ticket',validity:'unknown',capacity_units:2,unit_type:'person'}},create('d',asset),attach('l',ref('d','document'),b,ref('s','service'))]),sid=ids.s.service;
  const split={key:'split',type:'split_service',id:sid,expected_version:f.row('booking_services',sid).version,mode:'capacity',parts:[{capacity_units:1},{capacity_units:1}],reason:'Separate travellers'};
  assert.throws(()=>f.preview([split]),code('SPLIT_DOCUMENTS_REQUIRED'));
  split.parts[0].document_ids=[ids.d.document];split.parts[1].document_ids=[];
  const children=f.write([split]).split;
  assert.equal(one(f.db,'SELECT count(*) n FROM booking_documents WHERE service_id=? AND archived_at IS NULL',children.service_0).n,1);
  assert.equal(one(f.db,'SELECT count(*) n FROM booking_documents WHERE service_id=? AND archived_at IS NULL',children.service_1).n,0);
  assert(f.row('booking_documents',ids.l.link).archived_at);
  f.write([{key:'cancel',type:'set_service_state',id:children.service_0,expected_version:f.row('booking_services',children.service_0).version,state:'cancelled',reason:'Supplier cancellation'}]);
  assert.equal((await f.api('/api/documents/'+ids.d.document+'/content')).status,200);
});

test('GC respects historical bindings, active leases and backup leases; only expired unreferenced files are collected',async t=>{
  const f=await fixture(t),shared=f.publish(await f.upload()),privateAsset=await f.upload(),u=f.start(),future=Date.now()+3*86400000;
  run(f.db,"UPDATE document_uploads SET status='receiving',lease_until=? WHERE id=?",future+10000,u.id);
  run(f.db,'INSERT INTO document_storage_leases VALUES(?,?)','backup-test',future+10000);
  assert.equal(collectDocumentGarbage(f.db,{now:future}).skipped,true);run(f.db,'DELETE FROM document_storage_leases');
  collectDocumentGarbage(f.db,{now:future});assert.equal(f.row('document_assets',privateAsset.id).status,'deleted');assert.equal(f.row('document_uploads',u.id).status,'receiving');assert.equal((await f.api('/api/documents/'+shared.id+'/content')).status,200);
  const orphan=crypto.randomUUID();writeFileSync(f.db.documentStore.path('assets',orphan),PDF);
  collectDocumentGarbage(f.db,{now:future+20000});assert(!readdirSync(join(f.dir,'private','assets')).includes(orphan));
});

test('backup and restore include historical and private ready assets, expire partial uploads and refuse missing or tampered bytes',async t=>{
  const f=await fixture(t),doc=f.publish(await f.upload()),privateAsset=await f.upload(),pending=f.start();
  f.write([{key:'archive',type:'archive_document',id:doc.id,expected_version:f.row('documents',doc.id).version,reason:'Keep old version'}]);
  const folder=join(f.dir,'backup'),report=await backupDocuments(f.db,f.db.documentStore,folder);assert.equal(report.assets,2);assert.equal(all(f.db,'SELECT * FROM document_storage_leases').length,0);
  const restored=join(f.dir,'restored');assert.equal(restoreDocuments(folder,restored).verified,true);
  const copy=openDatabase(join(restored,'database.sqlite'));t.after(()=>copy.close());copy.documentStore=createDocumentStorage(join(restored,'documents'));
  assert.equal(documentRegistry(copy,f.users.viewer,doc.id).documents[0].availability,'ready');assert.equal(one(copy,'SELECT status FROM document_uploads WHERE id=?',pending.id).status,'expired');assert.equal(one(copy,'SELECT status FROM document_assets WHERE id=?',privateAsset.id).status,'ready');
  assert.throws(()=>restoreDocuments(folder,restored),/must be new/);
  const manifest=JSON.parse(readFileSync(join(folder,'manifest.json'))),file=join(folder,'documents','assets',manifest.assets[0].storage_key);
  writeFileSync(file,Buffer.alloc(PDF.length));assert.throws(()=>restoreDocuments(folder,join(f.dir,'bad-restore')),/hash\/type mismatch/);
  const raw=f.row('document_assets',privateAsset.id);rmSync(f.db.documentStore.path('assets',raw.storage_key));
  await assert.rejects(()=>backupDocuments(f.db,f.db.documentStore,join(f.dir,'bad-backup')),/unavailable/);assert.equal(all(f.db,'SELECT * FROM document_storage_leases').length,0);assert.throws(()=>restoreDocuments(join(f.dir,'bad-backup'),join(f.dir,'bad-restore')),/incomplete/);
});

test('0018 preserves every prior column and version on a populated stage-4 SQLite backup',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'taiwan-stage5-migration-')),folder=join(dir,'migrations');mkdirSync(folder);
  for(const n of readdirSync('drizzle').filter(n=>n.endsWith('.sql')&&n<'0018'))copyFileSync(join('drizzle',n),join(folder,n));
  const db=openDatabase(join(dir,'old.sqlite'));migrate(db,folder);await seed(db);
  run(db,"INSERT INTO users(id,display_name,created_at) VALUES('editor','Editor',1)");run(db,"INSERT INTO memberships VALUES(?,'editor','editor')",TRIP);
  const user={id:'editor',role:'editor'};
  applyPlanningChange(db,user,{path:'/api/planning/items',method:'POST',creationId:'choice',body:{kind:'decision',title:'Keep choice',note:'Keep note',options:[{id:'option-a',label:'A'},{id:'option-b',label:'B'}]}});
  applyPlanningChange(db,user,{path:'/api/planning/items',method:'POST',creationId:'hotel',body:{kind:'stay',title:'Confirmed hotel',date_start:'2035-01-04',date_end:'2035-01-07',places:[{place_id:'taipei-101',role:'lodging'}]}});
  upgradePlanningModel(db,user);const root=one(db,'SELECT id FROM planning_scopes WHERE parent_scope_id IS NULL').id;
  run(db,"UPDATE planning_items SET decision_mode='route_segment' WHERE id='choice'");
  run(db,"INSERT INTO planning_decisions(id,trip_id,scope_id,working_option_id,created_at,updated_at) VALUES('choice',?,?,'option-a',1,1)",TRIP,root);
  for(const option of ['option-a','option-b'])run(db,'INSERT INTO planning_scopes(id,trip_id,parent_scope_id,option_id,created_at,updated_at) VALUES(?,?,?,?,1,1)',option+'-scope',TRIP,root,option);
  const tables=all(db,"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_app_migrations'").map(t=>t.name);
  const columns=Object.fromEntries(tables.map(name=>[name,all(db,'PRAGMA table_info('+name+')').map(c=>c.name)]));
  const snapshot=d=>Object.fromEntries(tables.map(name=>[name,all(d,'SELECT '+columns[name].join(',')+' FROM '+name+' ORDER BY rowid')]));
  const before=snapshot(db);await backup(db.sqlite,join(dir,'copy.sqlite'));const copy=openDatabase(join(dir,'copy.sqlite'));t.after(()=>{db.close();copy.close();rmSync(dir,{recursive:true,force:true});});
  migrate(copy,'drizzle');assert.deepEqual(snapshot(copy),before);assert.deepEqual(snapshot(db),before);assert.deepEqual(all(copy,'PRAGMA foreign_key_check'),[]);assert.equal(one(copy,'PRAGMA integrity_check').integrity_check,'ok');
  migrate(copy,'drizzle');assert.deepEqual(snapshot(copy),before);assert.equal(one(db,"SELECT count(*) n FROM _app_migrations WHERE name LIKE '0018%'").n,0);
});

test('discard frees a private reservation, but never removes a shared document or a file protected by backup',async t=>{
  const f=await fixture(t,{maxBytes:1024,quotaBytes:1024}),u=f.start(PDF,{byte_size:900});
  assert.equal(discardDocumentUpload(f.db,f.users.editor,u.id).discarded,true);const a=await f.upload();
  run(f.db,'INSERT INTO document_storage_leases VALUES(?,?)','backup',Date.now()+60000);
  assert.throws(()=>discardDocumentUpload(f.db,f.users.editor,a.id),code('DOCUMENT_STORAGE_BUSY'));run(f.db,'DELETE FROM document_storage_leases');
  const doc=f.publish(a);assert.throws(()=>discardDocumentUpload(f.db,f.users.editor,a.id),code('DOCUMENT_ALREADY_SHARED'));assert.equal((await f.api('/api/documents/'+doc.id+'/content')).status,200);
});

test('route decisions leave stored documents and supplier facts intact when working placements disappear',async t=>{
  const f=await fixture(t),doc=f.publish(await f.upload()),ids=f.write([
    {key:'decision',type:'create_decision',data:{title:'Early departure'}},
    {key:'a',type:'add_option',decision_id:ref('decision','decision'),expected_version:1,data:{label:'Keep dates'}},
    {key:'b',type:'add_option',decision_id:ref('decision','decision'),expected_version:1,data:{label:'Earlier'}},
    {key:'v',type:'create_item',scope_id:ref('a','scope'),data:{kind:'visit',title:'Planned visit'}},
    {key:'choose',type:'choose_working',id:ref('decision','decision'),expected_version:1,option_id:ref('a','option')},
  ]);
  const before=all(f.db,'SELECT * FROM documents'),book=f.row('bookings',doc.book);
  f.write([{key:'switch',type:'choose_working',id:ids.decision.decision,expected_version:f.row('planning_decisions',ids.decision.decision).version,option_id:ids.b.option}]);
  assert.deepEqual(all(f.db,'SELECT * FROM documents'),before);assert.deepEqual(f.row('bookings',doc.book),book);assert.equal((await f.api('/api/documents/'+doc.id+'/content',{user:'viewer'})).status,200);
});

test('attaching a document does not change supplier conditions or invalidate an approved ticket time',async t=>{
  const f=await fixture(t),asset=await f.upload(),start='2035-01-07T08:00:00.000Z',end='2035-01-07T09:00:00.000Z';
  const ids=f.write([
    {key:'v',type:'create_item',data:{kind:'visit',title:'Taipei 101'}},
    {key:'slot',type:'upsert_placement',id:ref('v','placement'),expected_version:1,data:{precision:'exact',starts_at:start,ends_at:end,start_timezone:'Asia/Taipei',end_timezone:'Asia/Taipei'}},
    {key:'place',type:'link_place',placement_id:ref('v','placement'),expected_version:0,data:{role:'visit',place_id:'taipei-101'}},
    {key:'need',type:'create_need',data:{kind:'admission',label:'Entry',required_units:1,unit_type:'person'}},
    {key:'target',type:'set_need_target',expected_version:0,need_id:ref('need','need'),placement_id:ref('v','placement'),data:{}},
    {key:'b',type:'record_booking',data:{category:'activity'}},
    {key:'s',type:'add_service',booking_id:ref('b','booking'),data:{kind:'admission',state:'confirmed',title:'Actual ticket',validity:'exact_interval',starts_at:start,ends_at:end,start_timezone:'Asia/Taipei',end_timezone:'Asia/Taipei',capacity_units:1,unit_type:'person'}},
    {key:'sp',type:'set_service_place',expected_version:0,service_id:ref('s','service'),data:{role:'visit',place_id:'taipei-101'}},
    {key:'allocation',type:'set_need_service',expected_version:0,need_id:ref('need','need'),service_id:ref('s','service'),data:{}},
  ]);
  f.write([{key:'approve',type:'approve_placement',id:ids.v.placement,expected_version:f.row('planning_placements',ids.v.placement).version}]);
  const before=f.row('booking_services',ids.s.service);
  f.write([create('doc',asset),attach('bind',ref('doc','document'),ids.b.booking,ids.s.service)]);
  assert.deepEqual(f.row('booking_services',ids.s.service),before);
  assert.equal(readModel3(f.db,f.users.editor).derived.schedule.placements.find(p=>p.id===ids.v.placement).requires_review,false);
});

test('HTTP server streams beyond the JSON ceiling, returns bounded-upload errors and creates a verified assets backup',async t=>{
  const f=await fixture(t),existing=f.publish(await f.upload()),child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,DATABASE_PATH:join(f.dir,'source.sqlite'),DOCUMENT_ROOT:join(f.dir,'private'),PORT:'0',HOST:'127.0.0.1',APP_ORIGIN:'http://localhost:8080',AUTH_MODE:'bearer',AUTO_BACKUPS:'1',PUSH_VAPID_PRIVATE_KEY:'',PUSH_VAPID_PUBLIC_KEY:''},stdio:['ignore','pipe','pipe']});
  let logs='';child.stderr.on('data',c=>{logs+=c;});
  try{
    const output=await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('HTTP startup timeout: '+logs)),8000).unref())]);
    const port=String(output[0]).match(/port (\d+)/)?.[1];assert(port,logs);const base='http://127.0.0.1:'+port,headers={Origin:'http://localhost:8080',Authorization:'Bearer '+f.tokens.editor};
    const bytes=Buffer.from('%PDF-1.4\n%'+('x'.repeat(65536))+'\n%%EOF\n');
    const start=await fetch(base+'/api/documents/uploads',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({original_name:'large.pdf',byte_size:bytes.length,sha256:documentHash(bytes),mime:'application/pdf'})});assert.equal(start.status,201);const u=await start.json();
    const content=await fetch(base+'/api/documents/uploads/'+u.id+'/content',{method:'POST',headers,body:bytes});assert.equal(content.status,200);
    const finalize=await fetch(base+'/api/documents/uploads/'+u.id+'/finalize',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});assert.equal(finalize.status,200);
    const small=f.start(),stream=new ReadableStream({start(c){c.enqueue(Buffer.alloc(1000));c.close();}});
    const tooBig=await fetch(base+'/api/documents/uploads/'+small.id+'/content',{method:'POST',headers,body:stream,duplex:'half'});assert.equal(tooBig.status,413);assert.equal((await tooBig.json()).details.code,'UPLOAD_TOO_LARGE');
    const dl=await fetch(base+'/api/documents/'+existing.id+'/content',{headers:{...headers,Range:'bytes=0-3'}});assert.equal(dl.status,206);assert.equal(await dl.text(),'%PDF');
    const folder=join(f.dir,'backups','taiwan-'+new Date().toISOString().slice(0,10)+'.bundle');
    // Await graceful shutdown below: it waits for the in-flight automatic backup.
    child.kill('SIGTERM');await once(child,'exit');
    const manifest=JSON.parse(readFileSync(join(folder,'manifest.json')));assert(manifest.assets.length>=1);assert.equal(restoreDocuments(folder,join(f.dir,'automatic-restore')).verified,true);
  }finally{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
});
