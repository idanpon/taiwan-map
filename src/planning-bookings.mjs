import { all } from './sqlite.mjs';
import { TRIP } from './auth.mjs';
import { readModel3 } from './planning-command-service.mjs';
import { problem } from './planning-domain-store.mjs';

// Read-only trip registry. Every write uses the common changeset evaluator.
export function bookingRegistry(db,user,id=null,{history=false,now=Date.now()}={}){
  const model=readModel3(db,user,now),s=model.sources,d=model.derived;
  const bookings=s.bookings.filter(b=>b.archived_at==null&&(!id||b.id===id));
  if(id&&!bookings.length)problem(404,'BOOKING_UNAVAILABLE','Бронь недоступна.');
  const result=bookings.map(b=>({...b,...d.bookings.find(x=>x.id===b.id),services:s.services.filter(x=>x.booking_id===b.id).map(service=>({...service,...d.services.find(x=>x.id===service.id),
    places:s.service_places.filter(l=>l.service_id===service.id&&l.archived_at==null),
    preparation:s.service_tasks.filter(l=>l.service_id===service.id&&l.archived_at==null).map(l=>({...l,task:s.items.find(t=>t.id===l.task_id)})),
    needs:s.need_services.filter(l=>l.service_id===service.id&&l.archived_at==null).map(l=>({...l,need:s.needs.find(n=>n.id===l.need_id),coverage:d.needs.find(n=>n.id===l.need_id)}))}))}));
  for(const b of result){
    const documents=serviceId=>s.booking_documents.filter(l=>l.booking_id===b.id&&(serviceId===undefined||l.service_id===serviceId)).map(l=>{
      const d=s.documents.find(d=>d.id===l.document_id),asset=d.asset_id?s.document_assets.find(a=>a.id===d.asset_id):null;
      return {...l,document:{...d,asset,availability:d.kind==='link'?'external':asset?.availability||'unavailable'}};
    });
    b.documents=documents();for(const service of b.services)service.documents=documents(service.id);
  }
  const response={schema_version:3,revision:model.revision,evaluated_at:now,next_evaluation_at:model.next_evaluation_at,bookings:result,capabilities:model.capabilities};
  if(history&&id)response.events=all(db,`SELECT DISTINCT e.id,e.actor_id,e.action,e.created_at,e.operation_id,e.payload FROM planning_events e
    JOIN planning_result_event_refs r ON r.event_id=e.id WHERE e.trip_id=? AND (r.booking_id=? OR r.service_id IN (SELECT id FROM booking_services WHERE booking_id=?)) ORDER BY e.created_at,e.id`,TRIP,id,id).map(e=>({...e,payload:JSON.parse(e.payload)}));
  return response;
}
