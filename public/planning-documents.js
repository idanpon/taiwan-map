import { closed, validId, reference, checkVersion, textField, invalid } from './planning-domain-common.js';

const live=r=>r&&r.archived_at==null;
export const documentFields={
  create_document:['id','data'],replace_document:['id','expected_version','data','reason'],
  edit_document:['id','expected_version','data'],archive_document:['id','expected_version','reason'],
  attach_document:['id','expected_version','document_id','booking_id','service_id'],detach_document:['id','expected_version','reason'],
};
export function validateDocumentCommand(c){
  if(['create_document','replace_document'].includes(c.type))closed(c.data,['kind','title','asset_id','external_url']);
  if(c.type==='edit_document')closed(c.data,['title']);
  if(c.type==='create_document'){if(c.id!==undefined&&!validId(c.id))invalid('INVALID_ID','Некорректный ID документа.');}
  else if(!Number.isSafeInteger(c.expected_version)||c.expected_version<(c.type==='attach_document'?0:1))invalid('EXPECTED_VERSION_REQUIRED','Укажите версию документа или связи.',400);
}
export function documentAllocations(c){
  if(['create_document','replace_document'].includes(c.type))return ['document'];
  if(c.type==='attach_document'&&c.expected_version===0)return ['link'];
  return [];
}
export function documentContext({sources:s,before,ids,assets,actorId,trip,audit,mark,now}){
  const added=new Set();
  const row=(collection,value,entity)=>{const id=reference(value,ids,entity),r=s[collection].find(r=>r.id===id);if(!live(r))invalid('DOCUMENT_TARGET_UNAVAILABLE','Документ, бронь или услуга недоступны.',404);return r;};
  const version=(collection,r,c)=>checkVersion(before[collection].find(x=>x.id===r.id)||r,c);
  const add=(collection,id,data)=>{if(!validId(id)||s[collection].some(x=>x.id===id))invalid('ID_CONFLICT','ID документа уже занят.',409);const r={id,trip_id:trip.id,...data,...audit};s[collection].push(r);mark(collection,r);return r;};
  const archive=(collection,r)=>{r.archived_at=now;r.archived_by=actorId;mark(collection,r);};
  // A file is not a change of supplier conditions: keep service pin versions intact.
  const parent=l=>mark('bookings',s.bookings.find(b=>b.id===l.booking_id));
  function bind(id,d,b,service=null){
    if(service&&service.booking_id!==b.id)invalid('DOCUMENT_BOOKING_MISMATCH','Услуга относится к другой брони.');
    const l=add('booking_documents',id,{document_id:d.id,booking_id:b.id,service_id:service?.id??null});parent(l);mark('documents',d);return l;
  }
  function create(c,replaces=null){
    textField(c.data.title,'Название документа',300,true);
    const data={kind:c.data.kind,title:c.data.title,asset_id:c.data.asset_id??null,external_url:c.data.external_url??null,replaces_document_id:replaces};
    if(data.kind==='file'){
      if(!validId(data.asset_id)||data.external_url!==null||!assets.some(a=>a.id===data.asset_id&&a.trip_id===trip.id&&a.availability==='ready'))invalid('ASSET_UNAVAILABLE','Файл не готов или недоступен для привязки.');
    }else if(data.kind==='link'){
      if(data.asset_id!==null||typeof data.external_url!=='string'||data.external_url.length>4000||/[\s\x00-\x1f]/.test(data.external_url))invalid('INVALID_DOCUMENT_URL','Укажите HTTP(S) ссылку без пробелов.');
      let u;try{u=new URL(data.external_url);}catch{invalid('INVALID_DOCUMENT_URL','Некорректная ссылка.');}
      if(!['https:','http:'].includes(u.protocol)||u.username||u.password)invalid('INVALID_DOCUMENT_URL','Разрешены только HTTP(S) ссылки без данных входа.');
      data.external_url=u.href;
    }else invalid('INVALID_DOCUMENT_KIND','Документ должен быть файлом или ссылкой.');
    const d=add('documents',ids[c.key].document,data);added.add(d.id);return d;
  }
  function apply(c){
    if(c.type==='create_document'){create(c);return;}
    if(c.type==='attach_document'){
      if(c.expected_version!==0)invalid('DOCUMENT_LINK_IMMUTABLE','Для другой привязки создайте новую связь.');
      const d=row('documents',c.document_id,'document'),b=row('bookings',c.booking_id,'booking'),v=c.service_id?row('services',c.service_id,'service'):null;
      bind(ids[c.key].link,d,b,v);return;
    }
    if(c.type==='detach_document'){
      const l=row('booking_documents',c.id,'link');version('booking_documents',l,c);textField(c.reason,'Причина',2000,true);archive('booking_documents',l);parent(l);mark('documents',s.documents.find(d=>d.id===l.document_id));return;
    }
    const d=row('documents',c.id,'document');version('documents',d,c);
    if(c.type==='edit_document'){textField(c.data.title,'Название документа',300,true);d.title=c.data.title;mark('documents',d);return;}
    textField(c.reason,'Причина',2000,true);
    const links=s.booking_documents.filter(l=>live(l)&&l.document_id===d.id);
    if(c.type==='replace_document'){
      const replacement=create(c,d.id);
      for(const [i,l] of links.entries())bind(replacement.id+'_binding_'+i,replacement,s.bookings.find(b=>b.id===l.booking_id),l.service_id?s.services.find(v=>v.id===l.service_id):null);
    }
    for(const l of links){archive('booking_documents',l);parent(l);}
    archive('documents',d);
  }
  function finish(commands){
    for(const c of commands.filter(c=>c.type==='split_service')){
      const old=reference(c.id,ids,'service'),links=s.booking_documents.filter(l=>live(l)&&l.service_id===old);
      if(links.length&&c.parts.some(p=>p.document_ids===undefined))invalid('SPLIT_DOCUMENTS_REQUIRED','Явно распределите документы по каждой части услуги; [] оставляет часть без документа.');
      c.parts.forEach((p,i)=>{
        if(p.document_ids===undefined)return;
        if(!Array.isArray(p.document_ids)||p.document_ids.length>100||new Set(p.document_ids).size!==p.document_ids.length)invalid('INVALID_DOCUMENT_MAPPING','Нужен список уникальных ID документов.');
        const service=s.services.find(v=>v.id===ids[c.key]['service_'+i]);
        p.document_ids.forEach((id,j)=>{
          const d=row('documents',id,'document');
          if(!links.some(l=>l.document_id===d.id))invalid('INVALID_DOCUMENT_MAPPING','Документ должен быть привязан к исходной услуге.');
          bind(service.id+'_document_'+j,d,s.bookings.find(b=>b.id===service.booking_id),service);
        });
      });
      for(const l of links){archive('booking_documents',l);parent(l);}
    }
    const keys=new Set();
    for(const l of s.booking_documents.filter(live)){
      const d=s.documents.find(d=>d.id===l.document_id),b=s.bookings.find(b=>b.id===l.booking_id),v=l.service_id?s.services.find(v=>v.id===l.service_id):null;
      if(!live(d)||!b||l.service_id&&v?.booking_id!==b.id)invalid('DOCUMENT_BOOKING_MISMATCH','Связь документа не согласована с бронью.');
      const key=[l.booking_id,l.service_id,l.document_id].join(':');if(keys.has(key))invalid('DUPLICATE_DOCUMENT_BINDING','Такая связь документа уже есть.');keys.add(key);
    }
    for(const id of added)if(!s.booking_documents.some(l=>live(l)&&l.document_id===id))invalid('DOCUMENT_BINDING_REQUIRED','Новый документ нужно привязать к брони или услуге в этом пакете.');
  }
  return {apply,finish};
}
