import { all, one, run, transaction } from './sqlite.mjs';
import { TRIP, body, json } from './auth.mjs';
import { authorizePlanning, requireModel3 } from './planning-domain-store.mjs';
import { assetMetadata, documentProblem as problem } from './document-assets.mjs';
import { detectDocumentMime, documentHash } from '../server/document-storage.mjs';

const UPLOAD_TTL=24*3600000,GRACE=3600000;
const closed=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))problem(400,'INVALID_REQUEST','Проверьте поля запроса.');};
function access(db,user,write=false){authorizePlanning(db,user,write);requireModel3(db);}
function storage(db){if(!db.documentStore)problem(503,'DOCUMENT_STORAGE_UNAVAILABLE','Хранилище документов недоступно.');return db.documentStore;}
function ownUpload(db,user,id,now){
  access(db,user,true);
  const u=one(db,'SELECT * FROM document_uploads WHERE id=? AND trip_id=? AND owner_id=?',id,TRIP,user.id);
  if(!u)problem(404,'UPLOAD_UNAVAILABLE','Загрузка недоступна.');
  if(u.expires_at<=now)problem(410,'UPLOAD_EXPIRED','Срок загрузки истёк.');
  return u;
}
const uploadView=u=>({id:u.id,status:u.status,original_name:u.original_name,declared_size:u.declared_size,expires_at:u.expires_at});
export function startDocumentUpload(db,user,data,now=Date.now()){
  closed(data,['original_name','byte_size','sha256','mime']);
  return transaction(db,()=>{
    access(db,user,true);const store=storage(db);
    if(typeof data.original_name!=='string'||!data.original_name.isWellFormed()||!data.original_name.trim()||data.original_name.length>240||/[\x00-\x1f\x7f/\\]/.test(data.original_name))problem(400,'INVALID_FILENAME','Нужно имя файла без пути и управляющих символов.');
    if(!Number.isSafeInteger(data.byte_size)||data.byte_size<1||data.byte_size>store.maxBytes)problem(413,'UPLOAD_TOO_LARGE','Размер файла превышает допустимый предел.');
    if(typeof data.sha256!=='string'||!/^[a-f0-9]{64}$/.test(data.sha256)||!['application/pdf','image/png','image/jpeg'].includes(data.mime))problem(400,'INVALID_UPLOAD_TYPE','Нужны SHA-256 и тип PDF, PNG или JPEG.');
    // Expired reservations are retained until GC actually removes their possible bytes.
    const used=one(db,"SELECT COALESCE(SUM(byte_size),0) n FROM document_assets WHERE trip_id=? AND status<>'deleted'",TRIP).n;
    const reserved=one(db,"SELECT COALESCE(SUM(declared_size),0) n FROM document_uploads WHERE trip_id=? AND status IN ('pending','receiving','uploaded')",TRIP).n;
    if(used+reserved+data.byte_size>store.quotaBytes)problem(413,'DOCUMENT_QUOTA_EXCEEDED','Недостаточно места в квоте документов поездки.');
    const id=crypto.randomUUID();
    run(db,"INSERT INTO document_uploads(id,trip_id,owner_id,storage_key,original_name,declared_size,expected_sha256,declared_mime,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,'pending',?,?)",id,TRIP,user.id,crypto.randomUUID(),data.original_name.trim(),data.byte_size,data.sha256,data.mime,now,now+UPLOAD_TTL);
    return {...uploadView(ownUpload(db,user,id,now)),max_bytes:store.maxBytes};
  });
}
export async function receiveDocumentUpload(db,user,id,request,{now=()=>Date.now()}={}){
  const store=storage(db);
  const u=transaction(db,()=>{
    const u=ownUpload(db,user,id,now());if(u.status!=='pending')problem(409,'UPLOAD_STATE','Содержимое этой загрузки уже получено или записывается.');
    const length=request.headers.get('content-length');
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==u.declared_size))problem(400,'UPLOAD_SIZE_MISMATCH','Размер тела не совпадает с объявленным.');
    if(!request.body)problem(400,'UPLOAD_EMPTY','Нужны байты файла.');
    run(db,"UPDATE document_uploads SET status='receiving',lease_until=? WHERE id=?",now()+120000,id);return u;
  });
  try{
    const count=await store.receive(u.storage_key,request.body,u.declared_size);
    transaction(db,()=>{const current=ownUpload(db,user,id,now());
      if(current.status!=='receiving'||current.lease_until<=now())problem(409,'UPLOAD_STATE','Загрузка прервана; начните новую.');
      if(count!==u.declared_size)problem(400,'UPLOAD_SIZE_MISMATCH','Получен неполный файл.');
      run(db,"UPDATE document_uploads SET status='uploaded',lease_until=NULL WHERE id=?",id);
    });
  }catch(e){
    transaction(db,()=>{run(db,"UPDATE document_uploads SET status='failed',lease_until=NULL WHERE id=? AND status='receiving'",id);store.remove('staging',u.storage_key);});
    if(e.code==='UPLOAD_TOO_LARGE')problem(413,e.code,'Размер файла превышает объявленный.');
    throw e;
  }
  return uploadView(ownUpload(db,user,id,now()));
}
export function finalizeDocumentUpload(db,user,id,now=Date.now()){
  return transaction(db,()=>{
    const u=ownUpload(db,user,id,now),store=storage(db);
    if(u.status==='finalized')return {asset:assetMetadata(db,one(db,'SELECT * FROM document_assets WHERE upload_id=?',id))};
    if(u.status!=='uploaded')problem(409,'UPLOAD_STATE','Сначала загрузите содержимое файла.');
    let bytes,staged=true;
    try{bytes=store.read('staging',u.storage_key);}catch(e){
      if(e.code!=='ENOENT')problem(409,'UPLOAD_UNAVAILABLE','Файл загрузки недоступен.');
      staged=false;try{bytes=store.read('assets',u.storage_key);}catch{problem(409,'UPLOAD_UNAVAILABLE','Файл загрузки недоступен.');}
    }
    const mime=detectDocumentMime(bytes),hash=documentHash(bytes);
    if(bytes.length!==u.declared_size||hash!==u.expected_sha256)problem(422,'UPLOAD_HASH_MISMATCH','Размер или контрольная сумма файла не совпадают.');
    if(!mime||mime!==u.declared_mime)problem(422,'UPLOAD_TYPE_MISMATCH','Содержимое не соответствует PDF, PNG или JPEG.');
    if(staged)store.promote(u.storage_key);
    // A crash after rename leaves private bytes; retry checks the same immutable bytes.
    run(db,"INSERT INTO document_assets(id,trip_id,upload_id,storage_key,sha256,byte_size,detected_mime,original_name,status,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,'ready',?,?)",id,TRIP,id,u.storage_key,hash,bytes.length,mime,u.original_name,now,user.id);
    run(db,"UPDATE document_uploads SET status='finalized' WHERE id=?",id);
    return {asset:assetMetadata(db,one(db,'SELECT * FROM document_assets WHERE id=?',id))};
  });
}
export function discardDocumentUpload(db,user,id,now=Date.now()){
  return transaction(db,()=>{
    access(db,user,true);
    const u=one(db,'SELECT * FROM document_uploads WHERE id=? AND trip_id=? AND owner_id=?',id,TRIP,user.id);
    if(!u)problem(404,'UPLOAD_UNAVAILABLE','Загрузка недоступна.');
    if(one(db,'SELECT 1 FROM documents d JOIN document_assets a ON a.id=d.asset_id WHERE a.upload_id=?',id))problem(409,'DOCUMENT_ALREADY_SHARED','Общий документ и его история сохраняются. Отсоедините его от брони отдельной командой.');
    if(u.lease_until>now||one(db,'SELECT 1 FROM document_storage_leases WHERE expires_at>?',now))problem(409,'DOCUMENT_STORAGE_BUSY','Файл используется загрузкой или резервным копированием.');
    const store=storage(db);store.remove('staging',u.storage_key);store.remove('assets',u.storage_key);
    run(db,"UPDATE document_assets SET status='deleted' WHERE upload_id=?",id);
    run(db,"UPDATE document_uploads SET status='expired',lease_until=NULL WHERE id=?",id);
    return {discarded:true};
  });
}
export function documentRegistry(db,user,id=null,{history=false}={}){
  return transaction(db,()=>{
    access(db,user);
    const documents=all(db,'SELECT * FROM documents WHERE trip_id=?'+(id?' AND id=?':'')+' ORDER BY created_at,id',TRIP,...(id?[id]:[]));
    if(id&&!documents.length)problem(404,'DOCUMENT_UNAVAILABLE','Документ недоступен.');
    const result={documents:documents.map(d=>{const asset=d.asset_id?assetMetadata(db,one(db,'SELECT * FROM document_assets WHERE id=? AND trip_id=?',d.asset_id,TRIP)):null;return {...d,availability:d.kind==='link'?'external':asset.availability,asset,
      bindings:all(db,'SELECT * FROM booking_documents WHERE document_id=? ORDER BY id',d.id),
      content_url:d.kind==='file'?'/api/documents/'+d.id+'/content':null};})};
    if(id&&history)result.events=all(db,'SELECT e.id,e.action,e.created_at,e.actor_id,e.payload FROM planning_events e JOIN planning_document_event_refs r ON r.event_id=e.id WHERE r.document_id=? ORDER BY e.created_at,e.id',id).map(e=>({...e,payload:JSON.parse(e.payload)}));
    return result;
  });
}
export function downloadDocument(db,user,id,request){
  return transaction(db,()=>{
    access(db,user);const d=one(db,'SELECT * FROM documents WHERE id=? AND trip_id=?',id,TRIP);
    if(!d)problem(404,'DOCUMENT_UNAVAILABLE','Документ недоступен.');
    if(d.kind!=='file')problem(409,'EXTERNAL_DOCUMENT','Это внешняя ссылка, локального файла нет.');
    const a=one(db,'SELECT * FROM document_assets WHERE id=? AND trip_id=?',d.asset_id,TRIP),checked=storage(db).inspect(a,{includeBytes:true});
    if(checked.availability!=='ready')problem(410,'DOCUMENT_UNAVAILABLE','Файл отсутствует или не прошёл проверку целостности.');
    const bytes=checked.bytes,size=bytes.length,headers={'Content-Type':a.detected_mime,'Content-Disposition':"attachment; filename=\"document\"; filename*=UTF-8''"+encodeURIComponent(a.original_name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Accept-Ranges':'bytes','Content-Length':String(size)};
    let start=0,end=size-1,status=200;const range=request.headers.get('range');
    if(range){
      const m=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!m||!m[1]&&!m[2]||m.slice(1).some(x=>x&&!Number.isSafeInteger(Number(x))))return new Response(null,{status:416,headers:{...headers,'Content-Length':'0','Content-Range':'bytes */'+size}});
      if(m[1]){start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),size-1):size-1;}
      else{const suffix=Number(m[2]);start=Math.max(0,size-suffix);}
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||start>end)return new Response(null,{status:416,headers:{...headers,'Content-Length':'0','Content-Range':'bytes */'+size}});
      status=206;headers['Content-Range']='bytes '+start+'-'+end+'/'+size;headers['Content-Length']=String(end-start+1);
    }
    return new Response(request.method==='HEAD'?null:bytes.subarray(start,end+1),{status,headers});
  });
}
export function collectDocumentGarbage(db,{now=Date.now(),grace=GRACE}={}){
  return transaction(db,()=>{
    const store=storage(db);if(one(db,'SELECT 1 FROM document_storage_leases WHERE expires_at>?',now))return {skipped:true,removed:0};
    let removed=0;
    for(const u of all(db,'SELECT * FROM document_uploads WHERE expires_at<=? AND (lease_until IS NULL OR lease_until<=?)',now,now)){
      if(one(db,'SELECT 1 FROM documents d JOIN document_assets a ON a.id=d.asset_id WHERE a.upload_id=?',u.id))continue;
      store.remove('staging',u.storage_key);store.remove('assets',u.storage_key);
      run(db,"UPDATE document_assets SET status='deleted' WHERE upload_id=?",u.id);
      run(db,"UPDATE document_uploads SET status='expired',lease_until=NULL WHERE id=?",u.id);removed++;
    }
    for(const area of ['staging','assets'])for(const file of store.entries(area)){
      if(file.mtime>now-grace||one(db,'SELECT 1 FROM document_uploads WHERE storage_key=?',file.key)||one(db,'SELECT 1 FROM document_assets WHERE storage_key=?',file.key))continue;
      store.remove(area,file.key);removed++;
    }
    return {skipped:false,removed};
  });
}
export async function handleDocuments(request,db,user){
  const path=new URL(request.url).pathname,method=request.method;
  if(!path.startsWith('/api/documents'))return null;
  if(path==='/api/documents'&&method==='GET')return json(documentRegistry(db,user));
  if(path==='/api/documents/uploads'&&method==='POST')return json(startDocumentUpload(db,user,await body(request)),201);
  const upload=path.match(/^\/api\/documents\/uploads\/([a-f0-9-]{36})(?:\/(content|finalize))?$/);
  if(upload){
    if(!upload[2]&&method==='DELETE')return json(discardDocumentUpload(db,user,upload[1]));
    if(!upload[2]&&method==='GET')return json(uploadView(ownUpload(db,user,upload[1],Date.now())));
    if(upload[2]==='content'&&method==='POST')return json(await receiveDocumentUpload(db,user,upload[1],request));
    if(upload[2]==='finalize'&&method==='POST'){closed(await body(request),[]);return json(finalizeDocumentUpload(db,user,upload[1]));}
  }
  const doc=path.match(/^\/api\/documents\/([a-zA-Z0-9_-]+)(?:\/(content|events))?$/);
  if(doc&&doc[2]==='content'&&['GET','HEAD'].includes(method))return downloadDocument(db,user,doc[1],request);
  if(doc&&method==='GET'&&doc[2]!=='content')return json(documentRegistry(db,user,doc[1],{history:doc[2]==='events'}));
  problem(404,'DOCUMENT_ROUTE_UNAVAILABLE','Маршрут документов не найден.');
}
