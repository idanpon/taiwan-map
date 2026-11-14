// Typed reverse links for history/navigation; no title matching and no inferred facts.
export function affectedReferences(before,after,changes){
  const result={items:new Set(),placements:new Set(),needs:new Set(),services:new Set(),bookings:new Set(),documents:new Set()};
  for(const c of changes){
    if(c.collection==='decisions')result.items.add(c.id);
    if(result[c.collection])result[c.collection].add(c.id);
    for(const row of [c.before,c.after].filter(Boolean)){
      if(row.document_id)result.documents.add(row.document_id);
      if(row.replaces_document_id)result.documents.add(row.replaces_document_id);
      for(const [field,collection] of Object.entries({item_id:'items',task_id:'items',required_task_id:'items',decision_id:'items',placement_id:'placements',anchor_placement_id:'placements',from_placement_id:'placements',to_placement_id:'placements',need_id:'needs',service_id:'services',booking_id:'bookings'}))if(row[field])result[collection].add(row[field]);
      for(const s of [before,after])for(const key of ['option_id','other_option_id','required_option_id']){const option=s.options.find(o=>o.id===row[key]);if(option)result.items.add(option.item_id);}
    }
  }
  for(const s of [before,after]){
    for(const l of s.booking_documents||[])if(result.documents.has(l.document_id)||result.services.has(l.service_id)||result.bookings.has(l.booking_id)){
      result.documents.add(l.document_id);result.bookings.add(l.booking_id);if(l.service_id)result.services.add(l.service_id);
    }
    for(const p of s.placements){const item=s.items.find(i=>i.id===p.item_id);if(result.items.has(p.item_id)||item?.route_owner_decision_id&&result.items.has(item.route_owner_decision_id))result.placements.add(p.id);}
    for(const l of s.need_targets)if(result.placements.has(l.placement_id))result.needs.add(l.need_id);
    for(const l of s.need_services)if(result.needs.has(l.need_id))result.services.add(l.service_id);
    // Booking/service changes can affect capacity in every linked need, even if one allocation changed.
    for(const service of s.services)if(result.bookings.has(service.booking_id))result.services.add(service.id);
    for(const link of s.need_services)if(result.services.has(link.service_id))result.needs.add(link.need_id);
    for(const link of s.need_targets)if(result.needs.has(link.need_id))result.placements.add(link.placement_id);
    for(const link of s.need_tasks)if(result.needs.has(link.need_id))result.items.add(link.task_id);
    for(const link of s.service_tasks)if(result.services.has(link.service_id))result.items.add(link.task_id);
    for(const p of s.placements)if(result.placements.has(p.id)){result.items.add(p.item_id);const item=s.items.find(i=>i.id===p.item_id);if(item?.route_owner_decision_id)result.items.add(item.route_owner_decision_id);}
    for(const service of s.services)if(result.services.has(service.id))result.bookings.add(service.booking_id);
  }
  return Object.fromEntries(Object.entries(result).map(([key,ids])=>[key,[...ids].sort()]));
}
