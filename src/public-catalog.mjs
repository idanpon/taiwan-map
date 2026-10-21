import {TRIP,stmt,json} from './auth.mjs';
import {categories,verifiedAt} from './places.mjs';
import {readTags} from '../public/place-tags.js';

// A public projection, never a redacted private export. New private columns
// cannot become public simply by being added to a table or another endpoint.
export async function publicCatalog(db){
 const [ps,cs,ss,ls]=await db.batch([
  stmt(db,`SELECT p.id,p.name,p.local_name,p.city,p.category_id,p.lat,p.lon,p.address,p.summary,p.tip,p.hours_json,p.verified_at,p.tags_json,s.status_id FROM places p LEFT JOIN user_place_states s ON s.place_id=p.id AND s.user_id=? WHERE p.trip_id=? AND p.hidden=0 ORDER BY p.city,p.name`,'trip-shared',TRIP),
  db.prepare('SELECT id,label,color,icon,sort_order FROM categories ORDER BY sort_order'),
  stmt(db,'SELECT id,label,color,symbol,dimmed,sort_order FROM statuses WHERE trip_id=? AND archived=0 ORDER BY sort_order,label',TRIP),
  stmt(db,'SELECT l.place_id,l.label,l.url,l.kind FROM place_links l JOIN places p ON p.id=l.place_id WHERE p.trip_id=? AND p.hidden=0',TRIP)
 ]);
 return json({schema_version:1,access:'public',user:null,trip:{id:TRIP,name:'Тайвань',timezone:'Asia/Taipei'},verified_at:verifiedAt,
  categories:cs.results.map(c=>({...c,description:categories.find(d=>d.id===c.id)?.description||''})),
  statuses:ss.results.map(s=>({...s,dimmed:Boolean(s.dimmed)})),
  places:ps.results.map(({hours_json,tags_json,...p})=>({...p,hours:JSON.parse(hours_json),tags:readTags(tags_json),links:ls.results.filter(l=>l.place_id===p.id).map(({place_id,...link})=>link)}))
 });
}
