import { TRIP, SHARED_USER, fail, Problem } from './auth.mjs';
import { all, one } from './sqlite.mjs';
import { readZonePlan } from './reminders.mjs';
import { readSources } from './planning-domain-store.mjs';
import { activePlacement, taskApplicable } from '../public/planning-readiness.js';
const conflict = (message, details = {}) => {
  const error = new Problem(409, message);
  error.details = details;
  throw error;
};

export function itemById(db, id) {
  const item = one(db, 'SELECT * FROM planning_items WHERE id=? AND trip_id=?', id, TRIP);
  if (!item) fail(404, 'Запись календаря не найдена.');
  return item;
}
export function readItem(db, { transport_json, ...row }, sources=null) {
  const routeSources=sources||(row.route_owner_decision_id?readSources(db).sources:null);
  const placement = row.activation_scope_id && ['visit','stay','transport'].includes(row.kind) && (routeSources?
    routeSources.placements.find(p=>p.item_id===row.id&&activePlacement(routeSources,p)):
    one(db, "SELECT id FROM planning_placements WHERE item_id=? AND scope_id=? AND participation='included' AND archived_at IS NULL", row.id, row.activation_scope_id));
  const projectedPlaces = placement ? all(db,
    "SELECT l.*,p.name current_name,p.hidden FROM planning_placement_places l LEFT JOIN places p ON p.id=l.place_id WHERE l.placement_id=? AND l.archived_at IS NULL AND l.selection='chosen' AND l.role<>'reference' ORDER BY l.sort_order,l.id", placement.id
  ).map(l => ({
    id:l.id,item_id:row.id,option_id:null,place_id:l.place_id,
    place_name:['departure','arrival'].includes(l.role)?l.label_snapshot:l.current_name||l.label_snapshot,
    current_name:l.current_name,hidden:l.hidden,affects_visit:false,unselected_action:'keep',
    ...(['lodging','departure','arrival'].includes(l.role)?{role:l.role}:{}),
    deleted:!l.place_id&&!['departure','arrival'].includes(l.role),
  })) : null;
  return {
    ...row,
    fixed_external: Boolean(row.fixed_external),
    source_urls: JSON.parse(row.source_urls),
    ...(transport_json ? { transport: JSON.parse(transport_json) } : {}),
    options: all(
      db,
      'SELECT id,item_id,label,description,sort_order FROM planning_options WHERE item_id=? AND archived_at IS NULL ORDER BY sort_order,id',
      row.id,
    ),
    places: projectedPlaces ?? all(
      db,
      'SELECT l.*,p.name current_name,p.hidden FROM planning_item_places l LEFT JOIN places p ON p.id=l.place_id WHERE l.item_id=? ORDER BY l.role,l.option_id,l.place_id,l.place_name,l.id',
      row.id,
    ).map(({ role, ...l }) => {
      const endpoint = role === 'departure' || role === 'arrival';
      return {
        ...l,
        ...(role ? { role } : {}),
        affects_visit: Boolean(l.affects_visit),
        place_name: endpoint ? l.place_name : l.current_name || l.place_name,
        deleted: !l.place_id && !endpoint,
      };
    }),
    dependencies: all(
      db,
      'SELECT depends_on_id FROM planning_dependencies WHERE item_id=?',
      row.id,
    ).map((r) => r.depends_on_id),
  };
}
export function planningData(db, { legacy = false } = {}) {
  const model = one(db, 'SELECT planning_model FROM trips WHERE id=?', TRIP)?.planning_model;
  const sources=model===3?readSources(db).sources:null;
  return {
    model_version: model,
    ...(model === 3 ? { compatibility: { structural_writes: false, full_model: '/api/planning?model=3' } } : {}),
    trip: one(
      db,
      'SELECT id,name,timezone,departure_date,start_date,end_date,planning_version version FROM trips WHERE id=?',
      TRIP,
    ),
    timezone_plan: readZonePlan(db),
    items: all(
      db,
      'SELECT * FROM planning_items WHERE trip_id=? AND archived_at IS NULL' + (legacy ? " AND kind IN ('task','decision','visit')" : '') +
        (model === 3 ? " AND (kind NOT IN ('stay','transport') OR EXISTS(SELECT 1 FROM planning_migration_refs r WHERE r.source_table='planning_items' AND r.source_id=planning_items.id AND r.target_kind='placement'))" : '') + ' ORDER BY date_start,sort_order,title',
      TRIP,
    ).filter(row=>!sources||(row.kind==='decision'?row.decision_mode!=='route_segment':row.kind==='task'?taskApplicable(sources,row):row.state==='done'||sources.placements.some(p=>p.item_id===row.id&&activePlacement(sources,p)))).map((row) => readItem(db, row,sources)),
    users: all(
      db,
      "SELECT u.id,u.display_name name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.trip_id=? AND u.disabled=0 AND m.role IN ('admin','editor','viewer') ORDER BY u.display_name",
      TRIP,
    ),
    places: all(
      db,
      'SELECT id,name,city,hidden FROM places WHERE trip_id=? ORDER BY city,name',
      TRIP,
    ),
  };
}
export function unresolvedForPlace(db, placeId) {
  return all(
    db,
    `SELECT DISTINCT i.id,i.title FROM planning_items i JOIN planning_item_places l ON l.item_id=i.id WHERE i.trip_id=? AND l.place_id=? AND l.affects_visit=1 AND i.kind='decision' AND i.state IN ('open','in_progress') ORDER BY i.title`,
    TRIP,
    placeId,
  );
}
export function guardPlanningStatus(db, placeId, statusId, stateUser) {
  if (!one(db, "SELECT 1 FROM sqlite_master WHERE type='table' AND name='planning_items'")) return;
  const previous =
    one(
      db,
      'SELECT status_id FROM user_place_states WHERE user_id=? AND place_id=?',
      stateUser,
      placeId,
    )?.status_id ?? null;
  if (previous === statusId) return;
  const decisions = unresolvedForPlace(db, placeId);
  if (decisions.length)
    conflict(
      'Статус связан с незакрытым решением. Перейдите в календарь, чтобы зафиксировать выбор.',
      { code: 'planning_decision_required', decisions },
    );
}
export function currentPlace(db, id) {
  return one(
    db,
    `SELECT p.id,p.name,p.hidden,p.visibility_version,COALESCE(s.version,0) state_version,s.status_id,s.note FROM places p LEFT JOIN user_place_states s ON s.place_id=p.id AND s.user_id=? WHERE p.id=? AND p.trip_id=?`,
    SHARED_USER,
    id,
    TRIP,
  );
}
