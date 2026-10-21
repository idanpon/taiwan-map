import {readTags} from '../public/place-tags.js';
import {TRIP,stmt,body,fail,json} from './auth.mjs';

export async function handlePlaceLifecycle(request,db,user,stateUser){
 const path=new URL(request.url).pathname,method=request.method;
 const visibility=path.match(/^\/api\/places\/([a-zA-Z0-9-]+)\/visibility$/);
 const deletion=path.match(/^\/api\/places\/([a-zA-Z0-9-]+)$/);
 const bulk=path==='/api/places/hidden/delete-all'&&method==='POST';
 const listing=path==='/api/places/hidden'&&method==='GET';
 if(!bulk&&!listing&&!(visibility&&method==='PUT')&&!(deletion&&method==='DELETE'))return null;
 if(!['owner','admin','editor'].includes(user.role))fail(403,'Нужны права редактирования.');
 if(bulk){
  const b=await body(request,131072);
  if(!Array.isArray(b.places)||!b.places.length||b.places.length>5000||b.places.some(p=>typeof p.id!=='string'||!Number.isSafeInteger(p.version)))fail(400,'Подтвердите состав скрытых мест.');
  const expected=b.places.map(p=>({id:p.id,version:p.version})).sort((a,b)=>a.id.localeCompare(b.id));
  db.sqlite.exec('BEGIN IMMEDIATE');
  try{
   const current=db.sqlite.prepare('SELECT id,visibility_version version FROM places WHERE trip_id=? AND hidden=1').all(TRIP).sort((a,b)=>a.id.localeCompare(b.id));
   if(JSON.stringify(current)!==JSON.stringify(expected))fail(409,'Список скрытых мест изменился. Обновите список и подтвердите новое количество.');
   for(const p of current){
    for(const table of ['state_events','user_place_states','place_links'])db.sqlite.prepare('DELETE FROM '+table+' WHERE place_id=?').run(p.id);
    db.sqlite.prepare("DELETE FROM app_meta WHERE key LIKE 'import:%' AND CASE WHEN json_valid(value) THEN json_extract(value,'$.place_id') END=?").run(p.id);
    db.sqlite.prepare('DELETE FROM places WHERE id=? AND trip_id=? AND hidden=1').run(p.id,TRIP);
   }
   db.sqlite.prepare('INSERT INTO planning_events VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),TRIP,null,user.id,'places_deleted',JSON.stringify({count:current.length}),Date.now());
   db.sqlite.exec('COMMIT');return json({ok:true,count:current.length});
  }catch(error){db.sqlite.exec('ROLLBACK');throw error}
 }
 if(listing){
  const [ps,ls]=await db.batch([
   stmt(db,`SELECT p.*,s.status_id,s.note,COALESCE(s.version,0) version FROM places p LEFT JOIN user_place_states s ON s.place_id=p.id AND s.user_id=? WHERE p.trip_id=? AND p.hidden=1 ORDER BY p.city,p.name`,stateUser,TRIP),
   stmt(db,'SELECT l.* FROM place_links l JOIN places p ON p.id=l.place_id WHERE p.trip_id=? AND p.hidden=1',TRIP)
  ]);
  return json({places:ps.results.map(p=>({...p,hidden:true,tags:readTags(p.tags_json),tags_json:undefined,hours:JSON.parse(p.hours_json),hours_json:undefined,note:p.note||'',links:ls.results.filter(l=>l.place_id===p.id)}))});
 }
 const id=(visibility||deletion)[1],b=await body(request);
 if(!Number.isSafeInteger(b.version)||b.version<1)fail(400,'Некорректная версия места.');
 if(!await stmt(db,'SELECT id FROM places WHERE id=? AND trip_id=?',id,TRIP).first())fail(404,'Место уже удалено. Обновите список.');
 if(visibility){
  if(typeof b.hidden!=='boolean')fail(400,'Укажите, нужно ли скрыть место.');
  const changed=await stmt(db,'UPDATE places SET hidden=?,visibility_version=visibility_version+1,updated_at=? WHERE id=? AND trip_id=? AND visibility_version=?',Number(b.hidden),Date.now(),id,TRIP,b.version).run();
  if(!changed.meta.changes)fail(409,'Место уже изменено другим участником. Обновите список и повторите.');
  return json({id,hidden:b.hidden,visibility_version:b.version+1});
 }
 // Guard every child deletion with the parent version in one transaction.
 // A stale request must leave all notes, history, links and import data intact.
 const guard='EXISTS (SELECT 1 FROM places WHERE id=? AND trip_id=? AND visibility_version=?)';
 const results=await db.batch([
  stmt(db,'DELETE FROM state_events WHERE place_id=? AND '+guard,id,id,TRIP,b.version),
  stmt(db,'DELETE FROM user_place_states WHERE place_id=? AND '+guard,id,id,TRIP,b.version),
  stmt(db,'DELETE FROM place_links WHERE place_id=? AND '+guard,id,id,TRIP,b.version),
  stmt(db,"DELETE FROM app_meta WHERE key LIKE 'import:%' AND CASE WHEN json_valid(value) THEN json_extract(value,'$.place_id') END=? AND "+guard,id,id,TRIP,b.version),
  stmt(db,'DELETE FROM places WHERE id=? AND trip_id=? AND visibility_version=?',id,TRIP,b.version)
 ]);
 if(!results.at(-1).meta.changes)fail(409,'Место уже изменено другим участником. Обновите список и повторите.');
 return json({ok:true,id});
}
