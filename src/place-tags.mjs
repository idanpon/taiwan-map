import {TRIP,body,stmt,fail,json} from './auth.mjs';
import {mergeTags,readTags} from '../public/place-tags.js';

// Same authenticated catalog API. No public place editor or registration is added.
export async function handlePlaceTags(request,db,user){
 const match=new URL(request.url).pathname.match(/^\/api\/places\/([a-zA-Z0-9-]+)\/tags$/);
 if(!match||request.method!=='PUT')return null;
 if(!['owner','admin','editor'].includes(user.role))fail(403,'Нужны права редактирования.');
 const b=await body(request);
 if(!Number.isSafeInteger(b.version)||b.version<1)fail(400,'Некорректная версия ярлыков.');
 const place=await stmt(db,'SELECT tags_json,tags_version FROM places WHERE id=? AND trip_id=?',match[1],TRIP).first();
 if(!place)fail(404,'Место не найдено.');
 if(place.tags_version!==b.version)fail(409,'Ярлыки изменены. Обновите данные и повторите.');
 let tags;try{tags=mergeTags(readTags(place.tags_json),b.tags)}catch(error){fail(400,error.message)}
 const updated_at=Date.now();
 const result=await stmt(db,'UPDATE places SET tags_json=?,tags_version=tags_version+1,updated_at=? WHERE id=? AND trip_id=? AND tags_version=?',JSON.stringify(tags),updated_at,match[1],TRIP,b.version).run();
 if(!result.meta.changes)fail(409,'Ярлыки изменены. Обновите данные и повторите.');
 return json({tags,tags_version:b.version+1,updated_at});
}
