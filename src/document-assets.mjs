import { all, one } from './sqlite.mjs';
import { TRIP, Problem } from './auth.mjs';

export function documentProblem(status,code,message){const e=new Problem(status,message);e.details={code};throw e;}
export function assetMetadata(db,asset){
  const {id,trip_id,sha256,byte_size,detected_mime,original_name,created_by,created_at,status}=asset;
  return {id,trip_id,sha256,byte_size,detected_mime,original_name,created_by,created_at,status,
    availability:db.documentStore?.inspect(asset).availability||'unavailable'};
}
export function sharedAssetMetadata(db){
  return all(db,'SELECT a.* FROM document_assets a WHERE a.trip_id=? AND EXISTS(SELECT 1 FROM documents d WHERE d.asset_id=a.id) ORDER BY a.id',TRIP).map(a=>assetMetadata(db,a));
}
export function commandAssetGrants(db,user,commands,now){
  const ids=[...new Set(commands.filter(c=>['create_document','replace_document'].includes(c.type)&&c.data.kind==='file').map(c=>c.data.asset_id))];
  return ids.map(id=>{
    if(typeof id!=='string')documentProblem(400,'INVALID_ASSET','Укажите ID загруженного файла.');
    const asset=one(db,'SELECT a.*,u.expires_at FROM document_assets a JOIN document_uploads u ON u.id=a.upload_id WHERE a.id=? AND a.trip_id=?',id,TRIP);
    const shared=asset&&one(db,'SELECT 1 FROM documents WHERE asset_id=?',asset.id);
    if(!asset||!shared&&(asset.created_by!==user.id||asset.expires_at<=now))documentProblem(403,'ASSET_UNAVAILABLE','Файл недоступен для привязки.');
    const metadata=assetMetadata(db,asset);
    if(metadata.availability!=='ready')documentProblem(409,'ASSET_UNAVAILABLE','Файл отсутствует или не прошёл проверку целостности.');
    return {...metadata,expires_at:shared?null:asset.expires_at};
  });
}
